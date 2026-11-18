# MEMS PLN/MFG — Phase 1 acceptance checklist

**Target:** `lodongo/manufusion-mems` → `develop`, development service only.  
**Scope:** Products/SKUs, manufacturing master data, BOM/recipes, routing resources, initial PLN configuration, version activation and isolated fictional Line 11 test sandbox.  
**Source of truth:** [PLN/MFG Pilot Design](./PLN_MFG_INTEGRATED_PILOT_DESIGN_2026-11-17.md).

## Automated verification and evidentiary limits
- Latest verified baseline **ef4f80ddf76aa308c429300da28db47c6274388a**: [Phase 1 validation passed](https://github.com/lodongo/manufusion-mems/actions/runs/44161957049); [isolated development Cloud Run deployment passed and SHA matched /health](https://github.com/lodongo/manufusion-mems/actions/runs/44161977691).
- New Phase 1 tests check item/resource normalization, BOM quantities/cycles, routing dependencies, Inventory/Asset references, tenant-scoped routing and permissions, immutable version history, maker-checker activation, effective-date selection and demo isolation. See `tests/independent/pln-mfg-foundation.test.mjs`.
- Code-build success is **not** evidence that authenticated user UI workflows, Firestore persistence, or real tenant authorization were manually accepted. A dev-tenant login and the checks below remain necessary.
- The general MEMS independent validation suite continues to report **four Maintenance/Safety regressions** at the verified baseline. These are separate from Phase 1 testing but must be handled before declaring system-wide release readiness.
- If develop advances, read the latest dedicated Phase 1 workflow and development deployment results again before marking the new SHA deployed.

## Preconditions
1. Use isolated development service only: `https://mems-dev-404189184064.africa-south1.run.app` and verify the expected deployment SHA at `/health`.
2. Confirm the logged-in user belongs to a **designated non-production test organization** with completed Legal Entity, Site and Job Role configuration. Adopt MFG and PLN modules for the tenant.
3. Assign test roles with `MFG.view`, `MFG.master.edit`, `MFG.bom.edit`, `MFG.routing.edit`, `MFG.bom.submit`, `MFG.bom.approve`, `MFG.routing.submit`, `MFG.routing.approve`, `PLN.view`, `PLN.configure`. Test submission and approval by two different identities unless the documented audited development-only superuser override is explicitly enabled.
4. **No operational tenant data** may be populated with fictitious products, warehouses or inventory. Test fixture seeding is allowed only within `organizations/{testOrgId}/mfg_demo_sandboxes/LINE11_KHS_FICTIONAL_V1` and only via its governed endpoint.

## Test scenarios
| ID | Functional scenario | Passing acceptance evidence |
|---|---|---|
| P1-01 | Open PLN and MFG modules with distinct role permissions | Navigation and fields visible only to authorized roles; module-disabled gate enforced |
| P1-02 | Load MFG item list and create finished product and intermediate SKU | Draft saved in own tenant, revision 1 exists, reload retains values |
| P1-03 | Link a raw/packaging SKU to an existing published Inventory material | Published material appears in selector; invalid, unapproved or missing material rejected |
| P1-04 | Create manufacturing line/resource with optional Asset Register link | Only active and same-site asset references allowed; rate/efficiency validation works |
| P1-05 | Create and edit Manufacturing or Packaging BOM | Parent and component units are identical or have a compatible MEMS unit conversion; quantities positive; circular structure rejected; revision snapshots preserved |
| P1-06 | Create parallel-stage routing | Independent prep and bottle blowing stage outputs can feed filling; invalid resource or dependency rejected |
| P1-07 | Apply site-specific and organization-wide masters | A user cannot mutate another site's resource, BOM or routing; global records require direct administrative permissions |
| P1-08 | Submit BOM/routing and approve with separate user | Draft → pending approval → active; author cannot approve own submission; released revision cannot be overwritten |
| P1-09 | Publish variants and dated alternatives for one SKU | Duplicate category/alternative/site/date activation rejected atomically; different categories and alternatives coexist; ambiguous selection requires explicit choice |
| P1-10 | Save configuration and reload | Initial horizon, frozen period, lot strategy and production strategy persist with revision conflict detection |
| P1-11 | Verify isolated developer fixture | Authorized development test-mode admin may inspect the fictional multi-stage fixture through restricted test endpoints; normal Manufacturing UI must show no test scenario |
| P1-12 | Seed isolated Line 11 test fixture | Dev environment + authorized test tenant + active test mode + exact confirmation; creates only sandbox records, zero Inventory/Procurement/Finance postings |
| P1-13 | Verify seeded pilot records | Integrity verification reports matching record counts and no missing, changed or foreign references |
| P1-14 | Attempt duplicate seed or write with stale record revision | Idempotent seed; optimistic concurrency prevents lost updates; audit events recorded |
| P1-15 | Repeat actions with unauthorized, cross-tenant or disabled-module account | Correct 403/404 response, no record disclosure or mutation |

## Universal material and BOM requirements before downstream MRP
- A shared intermediate or subassembly can have a Manufacturing BOM without selecting a specific product variant.
- An intermediate may be explicitly non-stock-managed or stock-managed (linked to an approved Inventory material).
- A metered raw input, such as treated water, must reference an already configured equipment utility and cannot be issued again as Inventory.
- A final-product Packaging BOM may be created using its referenced material masters even before their upstream production BOMs exist. This is **not** proof of executable material readiness.
- BOMs for the same output and date may coexist across categories or alternative codes, with explicit selection; identical category/alternative/site/date releases cannot be duplicated.
- Unit conversions are restricted to compatible units from the central registry, not arbitrary cross-dimensional assumptions.
- No MRP run, purchase requisition, stock reservation or actual manufacturing transaction is created by these Phase-1 master-data configuration changes.

## Normalized commercial unit-case acceptance

- Configure a production form using MEMS's **Volume / L** unit.
- Create an organization normalization reference named **Unit Case (UC)**, select the production form, and define the reference as **5.678 L per UC** for a fictional volume-based example. MEMS must derive the reference UoM from the production form.
- Create a SKU with **1,000 mL** per primary container and **12 primary containers** per commercial case.
- Confirm the commercial package has **12 L**, and the stored normalization factor is **12 / 5.678 ≈ 2.1134 UC per physical commercial case**. It must not be stored as one UC simply because the selling package is called a case.
- Configure a transport pallet with 10 commercial cases per layer and 5 layers; confirm **50 commercial cases** and **600 L**, or approximately **105.67 normalized UC per transport unit**. This is a secondary calculation and must not alter the commercial conversion factor.
- Reject mismatched reference production dimensions (e.g., mass versus volume), invalid zero/negative references and references to missing or inactive production forms.
- Preserve pre-existing normalization references based on direct central MEMS units. Save the resolved reference, numerator, denominator and factor as a versioned SKU snapshot for traceability.

## Organization naming and normalization acceptance

- Normalization Units: choose **Divide** or **Multiply**. Divide calculates normalized units as commercial product quantity ÷ reference quantity; Multiply calculates normalized units as commercial product quantity × configured multiplier, with unit conversion first when needed.
- The reference unit comes from the selected production form. Non-positive factors, incompatible dimensions and invalid operators are rejected.
- SKU Configuration → SKU Naming Sequence: enable/reorder available SKU attributes, choose Name, Code, Quantity or Quantity + Unit where applicable, and choose an approved separator including underscore (`_`).
- Confirm the configured sequence generates the preview and persists with optimistic revision control and an audit event. The generated `SKU_#########` internal code must never change because of display-name configuration.
- Confirm new SKUs use the saved naming rule; old SKU names remain stable until the user explicitly opts into the latest sequence. Store the naming rule revision and generated name with the SKU master.

## Unverified by the automated GitHub checks
- Actual authenticated frontend navigation, input interactions and workflow dialogs in development, including confirmation that the industry-example selector and pilot tab are absent.
- Firestore write/read/update/revision history against a designated test tenant.
- Live master-data selector lists against the tenant's published Inventory and active Assets records.
- Complete seeded-sandbox verification after a real authorized seed.
- Usability review on narrow mobile and desktop viewports.

## Phase 1 completion rule
Phase 1 is **code-complete for baseline features**, not accepted, until P1-01 through P1-15 are executed against a verified non-production development tenant and failures are resolved. Do not silently launch Phase 2 or claim finished manufacturing execution on the strength of backend and frontend build checks alone.

## Planned boundary
Phase 2 adds demand entry/forecast consumption, demand allocation, MPS simulation/versioning and rough-cut capacity. Phase 1 contains **no live manufacturing execution, stock reservation/issue/receipt or purchasing** operations.

## General manufacturing acceptance (2026-11-18)
- All organizations use the same Product/Variant, Manufacturing BOM and Packaging BOM terminology, without sector presets or custom aliases.
- Newly saved BOMs use canonical MANUFACTURING or PACKAGING categories. Historical persisted records are normalized internally without old categories appearing in the interface.
- Components and output categories are not limited by beverage-specific rules. An integrated assembly can include packaging inputs, or manufacture a packaging item for downstream use.
- A Packaging BOM is optional when no separate pack-stage decomposition is needed. Drafting a BOM never requires preceding BOMs to exist, though execution readiness is checked separately.
- Test model is structurally reusable for process, discrete, assembly and mixed manufacturing; sector-specific execution rules require separate acceptance.
