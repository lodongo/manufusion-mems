# MEMS — Asset-Linked Production Planning Equipment & SKU Capacity
Date: 2026-11-18. Branch: `develop`. Source of truth: Organization Design + AST for equipment and assets, PLN for designation and SKU-specific commissioned throughput.

## Navigation / configuration
1. Open **Production Planning & MRP** > **Equipment & SKU Capacity**.
2. Select a legal entity visible within the user's authorized scope.
3. Choose an available site of that legal entity.
4. Manufacturing is an activity filter over **Finance cost centre type** (not a new org structure level). Only cost centres adopted as Manufacturing or Production and their departments appear.
5. Choose Manufacturing department, then a cost centre with that Finance cost-centre type.
6. Choose one **Equipment Unit** under that cost centre. Only equipment units linked one-to-one to an **active approved Asset Register** item are eligible.
7. Add one or more already created output SKUs. Configure **commissioned throughput** separately for each SKU, as a positive quantity per hour in the material master's UOM.
8. Save. Assets and Equipment Unit views display the read-only designation and throughput values.

## Hard rules
- Exactly zero or one active planning equipment designation **per manufacturing cost centre**. The unique key is `organizations/{org}/pln_equipment_capacity/{costCenterId}`; an atomic optimistic precondition guarantees two users cannot create competing assignments at the same time.
- A designation can be switched to another eligible equipment unit through a revision-checked update, not by creating a second designation.
- A designated equipment may have several SKUs with different commissioned hourly capacities. Duplicate SKU IDs, non-positive rates or incompatible rate units are rejected.
- The designated unit must belong to the chosen manufacturing cost centre, and its approved asset must be linked to that same equipment and site.
- Site-scoped permissions apply at the cost centre for PLN editing; organization scope and AST/PLN view permissions apply to the asset-side projection.
- Asset Management never writes the PLN mapping. Clearing a designation keeps historical revision/audit metadata and does not unlink or modify the Asset Register.
- Changing a physical equipment-asset link automatically makes any previously stored mismatched planning mapping *ineligible* in the asset projection and for subsequent saves, until repaired; do not silently assign a different asset.

## Boundaries
- Commissioned throughput is **nameplate/commissioned SKU-specific capacity**, not an efficiency-adjusted plan rate or actual line performance. Phase 4 will apply performance factors, shifts, calendar and maintenance downtime separately.
- The standalone Manufacturing Resources editor is hidden from the PLN screen; earlier approved manufacturing resource/routing data is retained and not deleted.
- Existing Demand & S&OP is not blocked by lack of equipment assignment; Phase 2 rough-cut capacity must later use these exclusive capacity records.
- Current release does not generate production orders, material reservations, stock movements or finance postings.
- Verify tenant UAT, mobile hierarchy, cross-site restrictions, asset visibility and concurrent writes before accepting this feature as fully deployed.
