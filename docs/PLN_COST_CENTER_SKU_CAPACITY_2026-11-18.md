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
