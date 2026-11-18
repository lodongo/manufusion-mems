# MEMS — Manufacturing Cost Centre SKU Configuration
2026-11-18 · `develop` only

## Design
Manufacturing/Production Planning capacity now belongs to the manufacturing **cost centre**. This is the parent of multiple Equipment Units; the system no longer chooses an equipment as a planning proxy. Physical equipment and its 1:1 Asset Register mapping are unchanged.

The same SKU editor can be reached from:
- **Organization Design → Manufacturing Cost Centre → gear (Configure planning SKUs)**
- **Production Planning & MRP → Manufacturing Cost Centre & SKUs**, via Legal Entity → Site → Manufacturing activity → Department → Cost Centre

The **pencil** remains the Organization Design editor for the cost centre itself. The gear no longer displays the general edit form. Equipment-unit and asset pages no longer render planning-capacity panels.

## SKU mapping
- Choose finished or intermediate outputs already in the universal Manufacturing Materials & Products master, limited to applicable site.
- For each selected SKU capture a distinct positive **commissioned throughput per hour** in the output material's master UOM.
- No repeated SKU on the same cost centre.
- Revision-checked, atomic, audited updates: `organizations/{org}/pln_cost_center_capacity/{costCenterId}`.
- Existing approved SKU materials/BOMs/routings remain their own source of truth; this master does not duplicate or create an SKU.
- Multiple SKUs are allowed per cost centre. Equipment-unit selection is no longer offered; existing asset/equipment configuration stays in its original modules.
- Clear mappings without deleting material or organization records.
- Authorization accepts site-scoped Planning or Organization Design rights; organization super admin may configure.
- Current implementation supplies commissioned capacity only. Scheduling must later apply efficiency, planned calendars, changeovers, maintenance downtime and routing constraints separately.

## Compatibility and removal
The earlier experimental `pln_equipment_capacity` assignment and `/api/org/pln/equipment/*` endpoints are retired, along with its equipment selector and read-only Asset panels. The earlier records, if any, are *not* silently interpreted as cost-centre capacity because they had a different assignment semantics. Historical database records may remain for audit, but are never read or written by the new app code. Use approved SKU data to configure cost-centre capacity again if needed.

## Acceptance
- Verify manufacturing cost centre classification against the organization's adopted Finance cost centre type.
- Test same populated editor from both the gear and PLN hierarchy.
- Test several SKUs with distinct throughput; edit/remove, revision conflicts, scope restrictions and UOM mismatch.
- Verify all equipment-specific Asset Register, Organization Design, Safety and Maintenance functionality remains available without newly introduced planning controls.
- No live stock, purchase, production, costing or finance postings from this setup.

## Physical-container commissioned rating (2026-11-18)
The primary commissioned rating is **a quantity of physical containers per selected time unit**, no longer the final SKU's stock UOM per hour. Physical Containers now hold an organization-configured default Count rating unit from the authoritative MEMS Units registry. New cost-centre mappings inherit this unit, but a different compatible Count unit can be chosen in Planning. The same page displays the physical-container category, subcategory, selected organizational type, configured attributes and container size.

All rate results use exactly **one time denominator** (selected from the published Time category: second, minute, hour or day). Daily ratings mean 24 elapsed hours, not a shift schedule. Count units such as Dozen are multiplied by their published conversion factor into physical-container count; the unit is never interpreted as the finished pack.

Let C be commissioned physical containers per selected period, V the SKU's production-form quantity per physical container, P the number of physical containers per commercial pack, and T the number of primary containers per transport unit. Then the same reference derives:
- Physical-container capacity = C
- Production-form capacity = C × V
- Finished commercial SKU capacity = C ÷ P (only when its SKU packaging is configured)
- Commercial-packaging capacity = C ÷ P
- Transport/logistics capacity = C ÷ T
- Optional normalized capacity = production form capacity ÷ configured production quantity per normalized unit

All P, T and V come from the selected SKU's **existing configuration and conversion engine**, not independently entered conversion factors. Missing or inconsistent SKU composition disables misleading conversions. The backend validates that the selected container category, subcategory, adopted container ID and size match the SKU. Save is revision-checked and returns the linked projection without posting transactions.

**Lookup contract:** `/api/org/pln/cost-center/rating` receives a scoped costCentre ID and SKU ID, reads the single cost-centre record, and recomputes its capacity projection against current SKU and Physical Container master data. This establishes one authoritative reference for downstream production-form, commercial-packaging and logistics planning views, without silently using stale conversion factors. The endpoint returns the configured rate and corresponding period. Old stock-UOM/hour records cannot be assumed to mean primary containers and require explicit reconfiguration.

Example using fictional demonstration numbers: 24,000 PET bottles/hour × 0.4 L = 9,600 L/hour; with 12 bottles/case the rate is 2,000 cases/hour; with 80 cases/pallet it is 25 pallets/hour. Switching the input period to minutes retains minutes for every derived figure. This is a commissioned rate, not a production-order posting, actual OEE, good-output rate or shift-adjusted schedule.

The Physical Container defaults and this Cost Centre rating form must be checked in an authenticated development tenant. Approved production versions, material stock and asset/equipment settings are unchanged.
