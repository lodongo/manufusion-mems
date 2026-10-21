# Maintenance sourcing (MNT-02 / MNT-03 / MNT-04 addendum)

Every material and external service belongs to a task of a work assessment, and later of a work order. The assessment estimates what is needed. The work-order planner confirms reservations, procurement demands and allocations. Procurement happens only in the existing Procurement Requirements process.

## Assessment screens

- **Menus, not side columns.** The work request page has a top menu: Request, Tasks, Summary. The work order uses a task menu above the task in place of the side column.
- **Asset, assembly and equipment** are adopted from the work assessment and shown read-only on each task. The assessment no longer asks for a related or duplicate request.
- **Adding a task.** A task is added with only its name and description (**Save task**), then opened to configure Task, Spares, Services, People & tools and Safety.
- **Task references.** The server gives each task a stable reference, `ASSMTASK_1`, `ASSMTASK_2` and so on. The internal task identifier stays unique, so the reusable task library is unaffected.
- **Spares.** Choose the warehouse first, then **Add spare** as many times as needed. Each spare comes from one of three sources, and every path asks for the quantity:
  - **Warehouse:** stock of that warehouse.
  - **Material catalogue:** category, then subcategory, then family, then the catalogue entry, then its attributes, with the mandatory ones required. The person then checks for registered materials of the same category, subcategory and family. Exact specification matches and close matches (attribute score and the differing values) are suggested. A new catalogue material cannot be added when a registered material has exactly the same specification.
  - **Free text:** the warehouse and catalogue are searched first, matches are offered, and the person must confirm that none is suitable.

## Materials: the selection hierarchy

The server enforces the order on every assessment save (`enforceSourcingRules`). The finder in the assessment Spares step follows the same order:

| Order | Source (`spare.source`) | What happens |
|---|---|---|
| 1 | `warehouse`: approved material with usable stock in a warehouse the person can reach | The planner reserves it. A partial quantity is reserved and the shortage is covered (see below). |
| 2a | `material`: approved registered material with no usable stock | The planner raises a purchase requirement for the full quantity, received into a warehouse that stocks the material. |
| 2b | `catalog`: technical catalogue entry that is not yet registered | Material creation and approval come first. |
| 3 | `description`: free text | Allowed only when all four conditions hold (see below). |

Conditions for free text:

- The person searched first. `POST /api/org/mnt/sourcing/materials` writes a search receipt to `mnt_search_receipts`. The receipt is tied to the person and the record, and is valid for 72 hours.
- The person confirmed that no suitable item exists.
- If the search found anything, the person explained why none of it is suitable (at least 10 characters).
- The spare carries a name and description, the function, specifications of at least 10 characters, quantity and unit, and the required date. Category, subcategory and photos or PDF drawings are optional.

The server also refuses these shortcuts:

- A `material` spare whose material has usable stock. The spare must come from the warehouse so the stock is reserved.
- A `catalog` spare with a mandatory attribute missing.
- A `catalog` spare whose specification (catalogue entry plus every attribute value) already exists as a registered material.
- A receiving warehouse the person cannot reach.

Spares saved earlier and left unchanged are not re-validated, so legacy assessments stay editable.

### Securing a spare on the work order (Spares tab)

`secure_spare` reserves usable, uncommitted stock (physical stock less reserved, quarantined, damaged and expired). It never reserves more than that. It then covers only the shortage, in this order:

1. **The existing supply link.** The task resource may already be linked to a requirement in `mnt_supply_links`. If that requirement is still open and covers the shortage, it is reused.
2. **An open replenishment.** If an open replenishment or MRP request for the same material and warehouse has enough uncommitted quantity, the shortage is linked to it. No duplicate requirement is raised.
3. **A maintenance requirement.** Otherwise the planner raises one, which needs a GL account and a date. It follows manager approval and the chart of authority.

There is one open requirement per work order, task and resource. Repeated actions, conversion from the assessment, task edits and controlled reassessment all return the same requirement.

### Free text through to procurement

1. The planner sends the spare for material creation.
2. Materials Master creates the draft, and the draft goes through the normal material approval.
3. On final approval, `maintenanceMaterialHook` runs. It links the task spare to the approved material code and pushes the need into Procurement Requirements as an automatic `unverified` request with source `maintenance`. Replenishment requests work the same way.
4. The planner verifies the request with **Verify and submit requirement** and becomes its requester. The request then follows manager approval and the chart of authority.
5. If the material is rejected, the task shows "Material rejected — respecify".

## External services (Services step and tab)

The assessment captures each service:

- category, subcategory and class
- scope and work instructions
- competencies and certifications
- people, hours and quantity
- deliverables and acceptance criteria
- execution date and estimated cost
- photos or drawings
- a **mandatory supplier category**, taken from the vendor class metadata: OEM, OCM, approved third-party service provider, specialist contractor, or another configured class

**Vendors.** Vendors come only from the approved vendor registry. A vendor qualifies when it is approved, its class equals the supplier category, and its service scope covers the category and subcategory. For OEM and OCM, the list narrows to vendors whose represented brands match the equipment manufacturer or brand on the asset register, whenever such a vendor exists. Proposed vendors are validated on save.

**Planner sourcing (`service_sourcing`).** The planner confirms the supplier category and either:

- picks a qualified vendor, or
- requests **supplier onboarding** when no approved vendor is suitable. If approved alternatives exist, the planner must give a reason of at least 20 characters. The request is written to `vendor_onboarding_requests` and appears in Procurement > Vendors > Onboarding requests. Vendor managers link the newly approved vendor of the same class, or decline the request.

No free-text vendor is ever stored as a supplier.

**Procurement (`procure`).** The service requirement carries:

- the work order and task references and the service code
- the specification, scope, acceptance criteria and competencies
- the supplier category and the preferred vendor, or the onboarding request
- the execution date and the cost centre
- the planning group (the work-order discipline and site)
- the attachments

Procurement sees all of this on the requirement detail. The requirement then follows sourcing, approvals, the purchase requisition and the purchase order. **Confirm service order** links the placed order line that came from this requirement.

## Fulfilment and readiness

Each read of the work order recalculates readiness from live records. Readiness is checked again before window approval.

- **Spares.** Each spare shows its stage: requirement, approval, sourcing, requisition, ordered, partly received, received. The data comes from `procurement_requirements`, `procurement_quotations`, `procurement_requisitions` and `procurement_orders`. A received shortage prompts **Reserve received stock**.
- **Services.** A service is ready only when it is secured on a placed purchase order. A cancelled order makes it not ready again.
- **Closed requirements.** A cancelled or rejected requirement is flagged so the planner can secure the resource again.
- **Task readiness.** A task is ready only when every spare is reserved or issued in full, every service is secured, and the personnel and tools are confirmed.

## Security and audit

**Routes.**

| Route | Permission | Additional rule |
|---|---|---|
| `org/mnt/sourcing/materials` | `MNT.view` | Assessment, planning or review rights at the record location |
| `org/mnt/sourcing/vendors` | `MNT.view` | Same as above |
| `org/mnt/sourcing/catalogue` | `MNT.view` | Same as above |
| `org/mnt/sourcing/similar` | `MNT.view` | Same as above |
| `org/procurement/vendors/onboarding-requests` | `PRC.vendors.manage` | Scoped to locations |
| `org/procurement/vendors/onboarding-requests/resolve` | `PRC.vendors.manage` | Scoped to locations |

The transaction catalogue places the routes in `MNT/SRC` and `PRC/VON`.

**Planning actions.** These keep the `MNT.WO.plan` permission and the `MNT.WO.PLAN` job-role gate. Material actions also need `INV.issue` at the warehouse.

**Approvals.** Purchases keep their standard requester and manager separation and the chart of authority. No new permission was introduced, so no new security role is required.

**Uploads.** Uploads accept JPEG, PNG and PDF of 1.5 MB or less, identified by their file signature. PDFs with active content are refused. Files are reachable only through short-lived signed links.

**Audit.** Every action is audited, including:

- reservations
- links to replenishment
- requirements
- the material link on approval
- onboarding requests and resolutions

**Tests.** `tests/independent/maintenance-sourcing.test.mjs` runs the addendum's acceptance tests end to end.
