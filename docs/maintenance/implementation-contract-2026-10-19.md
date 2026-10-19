# MEMS Maintenance — implementation contract (19 October 2026)

Status: implementation baseline; this document does not assert feature completion.

## Workflow and authorization
Work Request → Work Assessment → Work Order → Maintenance Window → Execution → Closure.
- Mobile-first, short swipeable sections; conventional Back/Next buttons; no search auto-focus in selectors.
- Anyone with normal access may raise a work request and contribute to work assessments.
- Only configured organizational roles may convert completed assessments into work orders.
- Assessment tasks may be multiple and each must carry its own risk assessment.
- Task risk assessments need no separate counter-approval. Complete hazard and control fields remain mandatory.
- Newly created tasks are recorded immediately against the originating assessment/work order, but require validation by a configured role before they become reusable asset task templates.
- Reusable task templates retain revisions; executed work-order task snapshots are immutable history.

## Resource requirements
- Spares: multiple entries, sourced from (1) warehouse stock, (2) material/spare catalogue, or (3) free-text description. Quantity and unit per item.
- Warehouse spares show availability and inventory-derived estimate; reserve quantity against authorized work order (without issuing stock). Partial availability can reserve available stock and create shortage, with Stores initiating procurement requisition. Ensure reservation idempotency/release on cancellation.
- Catalogue and description-only spares show costs pending sourcing, rather than invented estimates.
- Tools, services, labor and durations are task-specific. Service classification follows category, subcategory, class and technical attributes.
- A service can nominate 0–3 proposed suppliers from Vendor Master; final supplier selection remains Procurement's responsibility.

## Maintenance Windows
- A single window belongs to exactly one production line; only work orders belonging to that line are eligible.
- Start/end support hours, shift, day, week and custom ranges, with unique reference and calendar week.
- Only assessed/planned, not-yet-executed work orders can be scheduled.
- Gantt hierarchy: Window → Work Order → Task; dependencies, priorities, parallel scheduling and planned/actual durations.
- Extract actionable controls from equipment-level safety context (e.g., LOTO) and selected task risk assessments. Mandatory prerequisite safety steps gate dependent physical work.
- Compute critical path and float from task dependencies; detect cycles, conflicts, over-allocation, and work running beyond the window.
- Engineering and Safety each approve the overall window execution plan; no individual task risk-assessment approval.
- Schedule may be locked/released only when both approvals exist and safety prerequisites are satisfied; material amendments invalidate affected approvals.
- Emergency work can be handled under explicit exceptional policy and auditable authorizations.

## Consolidated safety print
Printable multipage report includes the equipment's overall safety controls relevant to the line and the specific tasks selected in the window ONLY. Include LOTO/isolation, hazards, initial/residual risk ratings, mitigation and window approval identities/timestamps; exclude unrelated equipment task-history assessments. Use Asset Management's existing evaluation/scoring model. Capture the approved report revision immutably.

## Acceptance tests required
1. Any eligible employee creates request and assessment; unauthorized conversion denied server-side.
2. Two tasks receive separate assessments; new task not reusable until validated.
3. Warehouse availability, estimate, partial reservation and shortage-to-Stores requisition flow remain consistent; repeated reservation does not double-allocate.
4. Proposed service vendors reject more than three and cannot silently become purchase orders.
5. Work order for Line B cannot join Line A's window even via direct API.
6. Safety prerequisites precede dependent jobs and block premature start.
7. Parallel tasks, critical path and cycle detection recalculate after edits.
8. Both engineering and safety approval required; change invalidates stale approval.
9. Consolidated PDF contains selected task assessments and equipment LOTO, but excludes unselected task assessments.
10. Responsive selection and swipe/next/back UX verified on Android; existing posting handlers unaffected.

## Delivery gates
Read the existing work request, asset/equipment safety, inventory reservations, procurement and organizational permission modules. Extend existing models/routes and shared design system. Add migrations, UI, backend validation and automated tests. Merge only with green CI; deploy only to existing mems-dev configuration and verify revision and authenticated happy path. Production remains unchanged until separately requested.
