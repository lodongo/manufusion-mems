# Cost-center category and subcategory classification

## Canonical master

The shared master is `src/shared/costCenterTaxonomy.ts`. It provides 32 industry-spanning
cost-center categories and 429 subcategories. Subcategory codes are stable
`<CATEGORY>-<NUMBER>` identifiers; a category also has an `<CATEGORY>-OTHER` entry.
Keep assigned codes stable when expanding the catalogue, and **append** additional
subcategories rather than renumbering older entries.

In Organization Design, each cost center retains the original category field
`attributes.costType` (for example, `MFG`, `INV`, or `WHS`) and adds
a canonical `attributes.costSubcategories: string[]` list. A singular
`attributes.costSubcategory` remains as a backwards-compatible alias to
the first selected code. All selections are saved on the same structural
cost-center record; no parallel classification store is introduced.

The Finance cost-center reference endpoint serves the taxonomy, alongside
approved custom Finance categories, and respects explicitly disabled categories.
MEMS default metadata is expanded additively, preserving saved category definitions
and customizations. A custom category without MEMS-defined subcategories uses
`GENERAL`.

## User workflow

1. Add or edit a cost center under a Department in Organization Design.
2. Select a **Cost center category** (for example `MFG · Manufacturing`).
3. Choose **one or more cost center subcategories** within the selected category,
   using the searchable checkbox list. For example select both
   `Simple syrup manufacturing` and `Final syrup and beverage blending`.
   Use **Select all shown**, **Clear selection**, or remove selected chips.
4. Choose its manager and save. Changing the category clears every previously
   selected subcategory, requiring at least one new compatible subcategory.

New cost centers require a category and at least one subcategory. Multiple
subcategories may be selected; no arbitrary single-subcategory limit applies.
Legacy cost centers with
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

The backend rejects malformed lists, duplicate codes, and any subcategory that
does not belong to the selected category. The frontend provides a dependent,
searchable multi-select list, preventing cross-category selection. Old singular
subcategories automatically appear as a one-item selection and migrate to the
canonical array on next save.
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
