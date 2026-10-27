# MEMS — Fourth Finance closure action: five proposed inventory GLs / 439 material references
Date: 2026-10-27 | Target branch: `develop` | **Reference verification complete; Finance posting approval still required**

## Deterministic reconciliation

The complete four-master, industry-aligned draft was compared at record level. It retains 1,804 GL accounts, 3,545 Materials, 1,002 Services and 1,943 Assets.

| Draft GL code | Designated reference | Dependent Materials |
| --- | --- | ---: |
| 10304080 | Safety/PPE supplies inventory | 105 |
| 10304090 | IT and telecom supplies inventory | 128 |
| 10307120 | Specialised industrial/other inventory | 197 |
| 10307130 | Advanced electronics/semiconductor inventory | 6 |
| 10307140 | Scientific/biofabrication materials inventory | 3 |
| **Total** | | **439** |

**Result:** zero missing GL references in the 439, five recognized draft balance-sheet/debit accounts, one specific inventory-receipt mapping dependency per affected material. The original 439 `finance_review_required` markers resulted from the five **proposed, not yet approved** GL extensions; they were not missing-account codes.

The five accounts must remain **pendingFinanceApproval=true** until formal approval. This technical verification is not proof that a tenant should capitalize, own, warehouse or recognize each item. `catalogueRelease=DRAFT_FINANCE_REVIEW` and `notAuthorizedForPosting=true` remain on every master.

## Additional domain review

Every affected material in the current technical templates is marked `NON_MRO`. This is not enough to conclude that an aircraft hose, crusher liner, scientific equipment component or other specialised part cannot be a maintenance spare in a tenant's actual operations. A purpose-based check is essential: inventory versus non-stock expense versus qualifying CAPEX, ownership (including consignment), stores classification, cost object, approved maintenance strategy and the legal entity's adopted GL rules.

The supplied Finance review pack marks such items for **purpose/classification review**, without changing their technical identifiers, MRO/Non-MRO branch, account history or original GL routing. General inventories such as 10307120 are *broad fallback references*, not automatically an acceptable substitute for a more specific, adopted legal-entity valuation account.

## Implemented controls

- `src/lib/glExceptionBundleReview.ts` deterministically checks the five proposed GL identities, reference bundle ID/version, all 439 affected routes, category compatibility, account sign/balance-sheet type, original pending Finance status, and that no proposed account or route is currently enabled for posting.
- MEMS Admin > Procurement > Materials draft preview now offers a **paired GL Master check** and a **Validate all 439 and record draft reference review** action. The reviewer enters an identifier and a reason; the action creates two locally downloadable reviewed-reference JSON files.
- Reference-review export changes the 439 reference statuses to `reference_validated_pending_finance_approval`; it **never** changes a postingActive flag to true or the four master release-state fields to APPROVED.
- `backend/catalogueReleaseGuard.ts` is used by the GL/Material/Service and Asset master import paths. It rejects master imports that only change the root `catalogueRelease` flag while GL accounts remain pending, any mapping remains unapproved, or approval evidence is missing.
- Independent tests verify grouping counts, the five GL definitions, MRO context, tampering, metadata mismatch, source preservation and server release restrictions.

## Required decision before production

An accountable Finance checker must determine whether all five inventory classes should exist, whether each is adoptable at legal entity scope, and whether any affected item is non-stock, consignment, MRO or capitalizable. Release must follow the existing role/governance policy; MEMS Admin upload alone does not override tenant adoption or transaction-level GL controls. The reference-review pack is an aid to that decision, not an approval action.

**Operational ledger:** the existing `GR_STOCK`, `GI_CC` and `GI_WO` posting handlers remain authoritative and unchanged by the reference review. Historical postings cannot be silently reclassified.
