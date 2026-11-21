# Cost-center category and subcategory classification

## Canonical master

The shared master is `src/shared/costCenterTaxonomy.ts`. It provides 32 industry-spanning
cost-center categories and 429 subcategories. Subcategory codes are stable
`<CATEGORY>-<NUMBER>` identifiers; a category also has an `<CATEGORY>-OTHER` entry.
Keep assigned codes stable when expanding the catalogue, and **append** additional
subcategories rather than renumbering older entries.

In Organization Design, each cost center retains the original category field
`attributes.costType` (for example, `MFG`, `INV`, or `WHS`) and adds
`attributes.costSubcategory`. Both codes are persisted on the same structural
cost-center record; no parallel classification store is introduced.

The Finance cost-center reference endpoint serves the taxonomy, alongside
approved custom Finance categories, and respects explicitly disabled categories.
MEMS default metadata is expanded additively, preserving saved category definitions
and customizations. A custom category without MEMS-defined subcategories uses
`GENERAL`.

## User workflow

1. Add or edit a cost center under a Department in Organization Design.
2. Select a **Cost center category** (for example `MFG · Manufacturing`).
3. Select a **Cost center subcategory** from that category only (for example
   `Simple syrup manufacturing` or `Final syrup and beverage blending`).
4. Choose its manager and save. Changing the category clears the previous
   subcategory selection and requires a new compatible subcategory.

New cost centers require both category and subcategory. Legacy cost centers with
an existing category but no subcategory are still readable and can be edited
without forcing a retrofit. Changing their category requires choosing a subcategory.

## Dependent modules

- **Finance:** Financial cost-center listing and details display both dimensions.
  Accounts, cost-center IDs, posting controls, and approval behavior are unchanged.
- **Manufacturing & Production Planning / MRP:** All `MFG` subcategories remain
  eligible for manufacturing resource and SKU-capacity mapping. SKU settings and
  existing physical-container throughput records remain in the shared capacity
  master. A cost center with manufacturing mappings cannot be reclassified away
  from `MFG` without first removing those mappings.
- **Inventory & Warehousing:** `INV` and `WHS` stay valid storage categories;
  their subcategories display in warehouse setup. An existing warehouse cannot
  be recategorized to an incompatible category while its storage setup exists.
- **Organization Design:** Category/subcategory appear in cost-center detail
  views. Existing node IDs, parent relationships, roles, equipment, and codes
  remain unchanged.

## Validation and rollout

The backend rejects a subcategory that does not belong to its selected category.
The frontend provides a dependent picker, preventing cross-category selection.
The route maintains legacy categories for existing records and accepts all current
MEMS categories even if Finance default metadata has not yet been initialized.

Run:
```sh
npm run check
npm run test:cost-centers
npm run build
```

The isolated development deployment workflow runs these checks before publishing.
The workflow is manually dispatched and deploys only the `develop` branch.
Deploy first to the isolated development environment and test MFG, INV and WHS
create, edit, classification change rejection, and dependent module visibility.
No production data migration or category recoding is required.
