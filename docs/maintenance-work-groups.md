# Maintenance Work Groups — controlled introduction

The work group is a site-level operational team, not a new cost center or financial posting object. One cost center has one work group. An employee may hold multiple generic titles, but only an existing current position assignment covering the relevant cost center qualifies. Draft configuration is restricted to workflow administrators, version checked, audit logged, and does not grant any operational access.

## Cutover release gates (not enabled by this change)
- Generate location-bound permissions from the intersection of active work group, cost center, mapped task, named incumbent, and current organizational assignment. Preserve ordinary employee request rights. Never broaden procurement, finance Chart of Authority, safety, handover or stores authorities.
- Resolve each workflow gate against the equipment's work group rather than the current global approverRoles setting. Distinct gate codes sharing a permission must not inadvertently grant the other transition.
- Replace single-position WR reviewer queue, automatic routing, named reviewer validation, assessment approval snapshots, asset task validation and all work order/window authority checks. Existing under-review and approved items need a controlled revalidation/reassignment path; never silently invalidate finalized history.
- Preserve the independently enforced requester/reviewer, assessor/approver, planner/cost approver, performer/verifier, and technical closure checks. A generic title is never a substitute for a different authenticated UID. Test administrators and direct/wildcard legacy security roles for bypasses.
- Independent maker/checker approval to publish configuration; versioned rollback and audit history. Include changes in window fingerprints and role approval snapshots. Simulate every assigned task and negative path before enabling. Fail closed for missing or ambiguous scope, revoked or expired assignment and stale config at an activated cost center.
- Test tenant/site separation, concurrent edits, repeated roles/titles, staffing vacancies, stale approvals, exact gate permission, and independent external authorities.

The Work Groups screen clearly marks saved records as drafts. Current workflow configuration remains authoritative. No migration or activation is performed in this change.
