# Materials Master — pre-approval security (PRC-001)

## Lifecycle boundary
A material is an editable draft only when its status is `draft`, approval level is zero, no approval instance/history exists, and it has never been submitted. The first successful PRC-001 submission ends draft editing and deletion permanently, including after rejection or termination. Changes to previously submitted master data use the separately configured **PRC-003 Material master change** workflow, not this draft path.

Draft **Delete** is a soft delete: the material disappears from the working list and duplicate search, while its record, actor, timestamps and audit trail are retained. All updates use Firestore `updateTime` preconditions to prevent a racing submission or deletion from being overwritten.

## Organization security roles
The standard PRC role catalogue exposes six assignable permissions:

| Permission | Effect |
|---|---|
| `PRC.materials.draft.edit.own` | Edit only drafts created by the user |
| `PRC.materials.draft.edit.any` | Edit unsubmitted drafts created by other users |
| `PRC.materials.draft.delete.own` | Delete own unsubmitted draft |
| `PRC.materials.draft.delete.any` | Delete another person's unsubmitted draft |
| `PRC.materials.draft.submit.own` | Submit own complete draft through PRC-001 |
| `PRC.materials.draft.submit.any` | Submit another creator's complete draft through PRC-001 |

Previously assigned `PRC.create` continues to allow own-draft edit, delete and submit, and `PRC.materials.manage` / `PRC.admin` grant management of all *unsubmitted* drafts. `PRC.view` is recommended for list visibility. Standard security role templates include **Material Draft Creator**, **Material Draft Editor**, **Material Draft Deleter**, and **Material Draft Submitter**; users and organizations configure these in the same role setup as all other permissions. The organization super admin retains organization-wide master permissions, but cannot change an already submitted draft through these endpoints.

## Segregation of duties
The creator, each subsequent editing user, and the submitter are all permanently included in `makerUids`. None may perform workflow review or approval for that material, regardless of whether they were subsequently granted a reviewer role. Prior reviewers cannot decide another stage in the same approval instance. Merely having `edit.any` or `submit.any` never confers approval rights; PRC-001 stage assignment remains authoritative.

## Development test mode
Only an organization super admin for a tenant explicitly enabled in the platform testing override, on an isolated development environment and before expiration, may bypass workflow assignment and maker–checker in PRC-001. The bypass is recorded in high-priority security audit events with the route, target, actor and controls relaxed. Other business integrity and tenant boundaries are not bypassed.

## Audit coverage
Authenticated API requests are logged by the common API audit guard, including denied attempts. Successful material draft creation, autosave, edit, submission, and soft deletion write material-specific business events. Events include actor ID, originator ID, changed field names, workflow identity, timestamps, and whether the action was delegated. Activity logs are preserved after draft deletion. A failed Firestore precondition returns a conflict instead of silently overwriting another user.

## Acceptance criteria
1. A draft creator with creation permission can create, edit, delete, submit their own draft.
2. A designated editor can edit another creator's draft only if assigned `edit.any`, and becomes a maker.
3. A designated deleter can delete only if assigned `delete.any`, cannot edit or submit without additional permission.
4. A delegated submitter can submit only if assigned `submit.any`, and becomes a maker.
5. All draft changes/deletions are refused once PRC-001 starts, even for an organization super admin, including after rejection.
6. Neither an original nor delegated maker can approve outside the isolated platform test override.
7. In test mode a super admin can complete the workflow and the bypass is prominently audited.
8. The Materials Master user interface only renders permitted actions as returned by the server. Backend checks remain authoritative.
