# Manufusion governance: production release gates

This checklist is **not a certificate of production readiness**. A green TypeScript build, audit inventory, or development deployment is not proof that unified transactions are enforced.

## Gate A — Every implemented transaction is registered
- Run `npm run audit:routes -- --json` and review `releaseGate`.
- Run `npm run audit:routes:strict` before release. Any unclassified or duplicate static route declaration blocks release.
- Identify dynamically registered endpoints and all non-route transaction writers; classify these separately.
- Maintain stable canonical transaction codes. Every permission-to-code mapping collision must be resolved with independent review.
- Require concrete evidence that each mapping's handler, module, submodule, scope, authorization and SoD rules are enforced.

## Gate B — Universal authorization
- Test each protected action against disabled module/submodule, missing permission, wrong organizational scope, another tenant and SoD conflict.
- Independently test authorization for direct API requests, not just hidden UI elements.
- Reserved blueprint records must not become executable simply through a status or permission-map change.

## Gate C — Authority and workflow
- For every approval-requiring action, verify configured monetary authority, legal-entity currency and FX, mandatory specialist streams, level quorum, delegation, amendment and reapproval.
- Exercise submit, approve, reject, return, cancel, escalation, history and failure handling through real endpoints.
- Verify atomic state transitions and replay/idempotency behavior.

## Gate D — Application integrity and UX
- Run unit, integration, tenant-boundary and real-device mobile browser tests.
- Fix and verify dropdown touch selection on supported Android/iOS browsers.
- Test every existing operational module's critical transaction path.

## Gate E — Production infrastructure and rollout
- Provision separate production project, Firebase Authentication/Firestore, storage, IAM/WIF and approved environment variables.
- Add a production-only workflow requiring reviewer approval, backup/restore test, rollback runbook and deploy artifact pinning.
- Complete production smoke tests, monitoring and incident contacts before inviting real tenants.

## Gate F — Sign-off
- Retain auditable evidence of all gates, reviewer identities and date of approval.
- Do not remove readiness notices or assert cutover completion without evidence.

Current static inventory deliberately reports `runtimeAuthorizationVerified:false` and `safeForProductionCutover:false` until actual runtime integration and certification are complete.
