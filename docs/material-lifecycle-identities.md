# Material requests, approval identities and test-mode authority

## Current workflow (PRC-001 / PRC-002 only)

The Organization Materials Master has one active approval definition for new materials (PRC-001)
and one for warehouse extension (PRC-002). Configured workflow snapshots are mandatory for
approval. Fixed Approver 1/2/3 routes, legacy migration UI/endpoints, manual material-number
allocation, and manual publication as a second approval-stage action are retired.

**New material**: first successful draft creation/autosave allocates `NWREQ_000000001` and
increments `system/counters.materialNewRequestSequence`. The request is stored at
`organizations/{orgId}/materials/{NWREQ_...}`. Drafts may be edited/deleted while approval
has not started, subject to creator/delegate security.

**Extension**: request submission allocates `EXREQ_000000001` from
`system/counters.materialExtensionRequestSequence`, stored in
`organizations/{orgId}/material_extensions/{EXREQ_...}`; the parent material remains
the same approved organization master. Extension is only available after PRC-002 approval.

**Final approval**: PRC-001 final approval atomically changes the request to `approved`,
allocates its immutable, 9-digit `MSTD_000000001` from
`system/counters.materialMasterDataSequence`, and updates the material's `masterDataId`,
`materialNumber`, original warehouse mapping and publication audit fields.
A reservation is created in `organizations/{orgId}/material_identity_reservations/{MSTD_...}`
in that same atomic Firestore commit. There is no intermediate approved-without-ID state.

The original `NWREQ_` request ID remains the Firestore primary key and foreign-key target:
inventory, requests, warehouse records and audit events already link to this key. The
`MSTD_` ID is the **approved master-data identity** shown prominently in the master list,
dashboard and inventory. Renaming the Firestore document would break existing references,
so approval updates its master identity rather than replacing its original request key.

The three sequences are database-managed and global across tenants. Numbers are unique
and strictly increasing within their own family; interrupted transactions can leave
gaps, which is preferable to reuse or collisions. The nine-digit limit is enforced.
Historic `MAT-` request IDs remain readable and editable if still genuine unsubmitted
drafts. Historic non-`MSTD_` approved material IDs are not silently reassigned.

## Approvals tab

The first tab on each material dashboard is **Approvals**, containing the PRC-001 request
identity, assigned workflow stages, stage decisions and comments, pending extension
requests with their independent `EXREQ_` identities, and the approved `MSTD_` number.
Approval/rejection actions are managed here. The Warehouse tab describes approved
and pending mappings, without duplicating approval controls.

## Development-only override

In a named, time-bounded development test session, an organization super admin can execute
all authorized material workflow stages, including self-approval and maker–checker
bypass. The backend checks `ctx.testMode === true` and
`ctx.role === 'org_super_admin'`; no UI flags or request-body fields grant this.
`testModeCore.bypass` records the relaxed assignment/segregation control in a
**high-priority security audit event** on the actual approval action. Mere list or dashboard
viewing does not record a fictitious bypass.

All eligible action buttons invoked under that override have a visible **blue border**,
including the material dashboard, request creation/extension controls and material workflow
inbox. Ordinary users retain maker–checker, role, approval stage and draft restrictions.
Status, missing workflow definitions, material classification, tenant scope and inventory
integrity are not waived by test mode.

## Acceptance / validation

- Request IDs match `^NWREQ_\\d{9}$`, extension IDs `^EXREQ_\\d{9}$`, master identities
  `^MSTD_\\d{9}$`.
- A final approval must either commit MSTD reservation + approved material + original
  warehouse mapping together, or make no material status change.
- Each request ID is immutable. Historical linked records retain referential integrity.
- Approvals are shown before Dashboard, Attributes, Warehouses, Availability and History.
- A valid test-mode super admin can approve a request they created, with high-priority audit
  and blue action border. Outside authorized test mode, this is denied.
- There are no executable material legacy migration or fixed-approver routes.
