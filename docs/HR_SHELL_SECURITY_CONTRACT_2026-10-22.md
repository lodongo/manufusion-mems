# HR read-only shell: security and integration contract

Status: initial read-only component committed; not connected to the live organization router. No production deployment or backend HR activation.

## Access defaults
- Default DENY. An HR job title alone confers no privileges. Job roles and security roles are distinct.
- Self-service data: only authenticated subject identified by verified uid/employee mapping; no client-supplied employee identifier may widen access.
- Employee register: explicitly authorized HR personnel, scoped to legal entity/site/department; sensitive fields are separately masked and never included in generic table export.
- Organization design and occupational roles: read-only projections of Organization Admin; never duplicate masters.
- Disciplinary, payroll, medical, bank, grievance, and candidate data: separate restricted case/data permissions; no implicit HR.view inheritance.
- Super-admin: configuration privileges do not imply unfettered access to sensitive personnel case contents.
- Authorize on every backend read and write; frontend navigation is UX only. Filter at query source, not after fetching all records.
- Every employee data read, denied access, export, approval decision and mutation must produce immutable audit events (tenant, actor, subject, scope, purpose, action, timestamp, request correlation). Never log salaries or personal data in event descriptions.
- Exports require dedicated permission and server-side masking, audit and per-scope restrictions. Saved table templates may store filter/layout metadata only, never cached personnel data.
- Form changes: strict schema, type and reference verification, cross-field checks, optimistic concurrency and server validation.
- Role grants and policy changes require independent approval and segregation-of-duties checks; no self approval.
- Cost-bearing HR operations must be bound to existing transaction governance and Chart of Authority with currency limits, effective dates and simulation before go-live.
- Audit and governance should fail closed if authoritative policy configuration is missing; no bypass via direct endpoints.
- All output remains read-only until acceptance tests exercise cross-tenant rejection, unauthorized requests, forged roles, export isolation, SoD, and workflow rejection.

## Mobile table contract
Use existing src/components/RichTable.tsx: pinned action bar, internal scroll, global search, column filters (contains, comparisons, lists), sort, reorder/show/hide, Excel export, saved views/templates. Never insert sensitive fields or unrestricted rows into the table. Entire page should not horizontally scroll; let table contents scroll within the table viewport.

## Open product decisions
1. Which occupational position(s) qualify for HR-wide read access at each legal entity/site? Recommended: zero by default; authorize only named HR security-role assignments in scope.
2. Can local HR officers see other sites' employees? Recommended: no; require separate explicit cross-site permission.
3. Are supervisors allowed to view team leave and role/skill information? Recommended: yes, only direct and delegated reporting lines, without salary/disciplinary/medical records.
4. Is the first release integrated with external payroll? Recommended: payslip access withheld until a scoped payroll interface is operational.

## Implementation sequencing
1. Wire the isolated HR shell into the current navigation behind a real server-validated HR module view permission and feature adoption gate.
2. Add HR read endpoints with explicit scope, redaction and audit.
3. Register HR security permissions as enforceable rights in backend/permissionPolicy.ts and create default inactive HR role templates through existing organization role adoption.
4. Register HR approval transactions with existing governance and bind CoA before enabling actions.
5. Test mobile shell and tables at 320px, 375px, 768px and desktop; verify keyboard and sticky header behavior.
