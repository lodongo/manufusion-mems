# Transaction Governance replacement — implementation baseline

Status: **development; not approved for transaction execution or tenant migration**.

## Confirmed architecture

The 30 accepted decisions define the requirements for the complete replacement.
The existing transaction handlers remain authoritative until both platform and tenant
cutover authorizations are obtained. No temporary dual-execution architecture is allowed.

## Audit findings verified from develop

| Component | Observed implementation | Required migration |
| --- | --- | --- |
| backend/permissionPolicy.ts | BUILT_PERMISSIONS combines fine-grained MNT activity codes with composite PRC.manage and legacy INV_ST codes. | Audit every endpoint; map each enforced action to an immutable canonical action ID; keep compatibility aliases non-granting until mapping verified. |
| backend/maintenance.ts | MNT_ACTIVITIES and per-location authorization checks already exist. Work requests and work orders have distinct state machines. | Model every state transition; preserve no-self-review and safety/verification SoD. |
| backend/procurementPolicy.ts | Procurement CoA uses locally persisted amount tiers, level definitions and in-module versioning; amount is in organization currency. | Replace with hierarchy-aware mandatory rule evaluator, multi-currency evidence and independently approved changes. |
| backend/procurementAuthority.ts | Descriptive action/actor/separation catalogue exists, including placeholder status. | Retire descriptive authorization as execution authority; retain only verified action references. |
| backend/purchaseOrders.ts | PO approvalRoute resolves tiers and concrete job role holders; PO retains route/approval state. | Introduce flexible authority streams, quorum, live capacity validation, amendments and reassessment; migrate pending POs without changing identifiers. |
| src/org/MaterialWorkflow.tsx | Workflow editor supports role/manager/user, all/any and sequential/parallel; 20-step cap and high-risk termination option. | Replace with flexible per-stream hierarchy, approved group assignment, quorum and dependencies; no silent workflow termination. |
| backend/workflowTrace.ts | Workflow summaries read multiple specific source collections and older workflow registry. | Replace with normalized cross-module workflow inbox while retaining historical links and scope checks. |
| backend/positions.ts | Primary + limited temporary assignments, position securityRoles and staffing plan. | Check actual assignment capacity and time validity per decision, including cross-unit authority. |
| backend/guards.ts | Access checks, legacy permission expansion, job role grants and audit. | Integrate registry action validation without widening existing privileges. |

## Phase contracts and acceptance gates

1. **Audit:** exhaustive route/permission/state-transition mapping and data inventory.
2. **Registry:** server-maintained action definitions with explicit handler enforcement verification; no self-declared active status.
3. **Security:** per-action role checks and capacity-specific scoped authority, preventive and runtime SoD.
4. **CoA:** approved effective rules, inheritance, mandatory combination, value/FX evidence, multiple streams, fail closed.
5. **Workflows:** hybrid assignment, group quorum, dependency DAG, SLA, delegation, re-evaluation and amendments.
6. **Administration:** mobile-first unified UI, governance templates, separate change proposer and approver, simulations.
7. **Module integration:** PO and WR reference integration followed by other built transactions; one authoritative engine per record.
8. **Migration:** tenant dry runs and reconciliation of pending/completed workflows with immutable historical evidence.
9. **Release:** security, tenant isolation, end-to-end and recovery test evidence; platform technical certification **and** tenant sign-off.

## Implemented foundations

- `backend/transactionRegistry.ts`: discovery projection only; all permissions unverified/unconfigured.
- `backend/governanceCore.ts`: isolated deterministic amount/condition evaluator and quorum calculator.
- `backend/governanceCore.test.ts`: basic regression scenarios.
- `.github/workflows/governance-validation.yml`: checks, tests and build, *never deploys*.

## Remaining blocking design/engineering work

- Runtime storage schema: transaction action, versioned governance bundles, assignments, approvals, events, migration checkpoints.
- Strongly consistent decisions and concurrency-safe approvals/quorum counting.
- Explicit versioned governance proposals + independent approver adjudication.
- Conflict/coverage validation: gaps, overlap, currency conversion, condition compatibility, protected mandatory rules.
- Real-world FX rate and rate-source resolution; failures must not be silently converted.
- Hierarchical scope and effective inheritance, specialist overrides and bounded cross-unit access.
- Workflow resolver for role/manager/named/group assignments and separate acting capacities.
- Timed reminders/escalations via durable scheduler and tenant holiday calendars.
- Risk/change field materiality, revision hashes, selective previous-approval invalidation.
- Tamper-evident persisted audit design with reporting and retention controls.
- Full cross-module inbox adapters, responsive UI and Excel reports.
- Inventory of actual tenant data, current assignments, pending records and migration constraints.
- Verified CI checks and integration tests; migration rehearsal; dual cutover approvals.

## Safety invariants

- An unverified registry entry cannot grant permission or be activated.
- A missing valid effective governance configuration blocks controlled actions.
- A failed FX conversion or missing approver cannot be treated as approval.
- One human cannot satisfy two independently required approvals on one transaction.
- Changing an authority rule triggers pending-work reassessment with audited history.
- Legacy behavior is not disabled until migration, regression checks and tenant acceptance pass.
