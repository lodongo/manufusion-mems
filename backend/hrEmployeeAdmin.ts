import { HttpError, getDoc, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { canGrant, createOrgUser, orgUsers, record } from './org';
import { nextOrgCounter } from './positions';
import { withLock } from './finCore';
import { adminTotals, MAX_ORG_ADMINS, MIN_ACTIVE_ORG_ADMINS } from './adminRoster';
import { ORG_SYSTEM_ROLES } from './org';

// ---------------------------------------------------------------------------
// HR > Employee Records & Administration: adding employees (user accounts) and employee numbers.
//
// Employee number: EMP_ followed by five digits (EMP_00001 …), unique in the organization. The number comes from
// the organization's database counter (organizations/{orgId}.employeeSeq) and is reserved in
// organizations/{orgId}/employee_numbers/{EMP_nnnnn} with create-only semantics, so two people can never get the
// same number even if the counter were ever reset. Numbers are system-managed and never edited by hand.
// Assigning numbers to employees who have none follows the order they were registered (oldest first).
// ---------------------------------------------------------------------------

export const EMP_RE = /^EMP_\d{5}$/;
const MAX_EMP = 99999;
const LOCK = 'employee_numbers';
const reservePath = (orgId: string, code: string) => `organizations/${orgId}/employee_numbers/${code}`;
const nameOf = (u: Doc) => `${str(u.data.firstName)} ${str(u.data.lastName)}`.trim() || str(u.data.email);
const isEmployee = (u: Doc) => str(u.data.role) !== 'applicant';

/** Next free number from the organization counter, reserved for this person. Call under the employee_numbers lock. */
async function allocate(orgId: string, uid: string, inUse: Set<string>): Promise<string> {
    for (let tries = 0; tries < 50; tries++) {
        const n = await nextOrgCounter(orgId, 'employeeSeq');
        if (n > MAX_EMP) throw new HttpError(409, 'Employee numbers are exhausted (EMP_99999). Contact MEMS support.');
        const code = `EMP_${String(n).padStart(5, '0')}`;
        if (inUse.has(code)) continue;
        if (await writeDoc(reservePath(orgId, code), { uid, at: nowIso() }, { exists: false })) {
            inUse.add(code);
            return code;
        }
    }
    throw new HttpError(503, 'Could not assign an employee number. Please try again.');
}

const missingOf = (users: Doc[]) =>
    users
        .filter((u) => isEmployee(u) && !EMP_RE.test(str(u.data.employeeNumber)))
        .sort((a, b) => (str(a.data.createdAt) || '9999').localeCompare(str(b.data.createdAt) || '9999') || a.id.localeCompare(b.id));

/** Roles an HR user may give a new employee: never more rights than their own, super admin only by a super admin. */
async function assignableRoles(ctx: OrgContext, users: Doc[]) {
    const roles = await listDocs(`organizations/${ctx.orgId}/roles`);
    const totals = adminTotals(users);
    return roles
        .filter((r) => r.id !== 'default_security')
        .filter((r) => {
            if (r.id === 'org_super_admin') return ctx.role === 'org_super_admin' && totals.designated < MAX_ORG_ADMINS;
            if (r.id === 'org_user') return true;
            const perms = Array.isArray(r.data.permissions) ? (r.data.permissions as unknown[]).map(str) : [];
            return canGrant(ctx, perms);
        })
        .map((r) => ({ id: r.id, name: str(r.data.name) || ORG_SYSTEM_ROLES[r.id]?.name || r.id }))
        .sort((a, b) => (a.id === 'org_user' ? -1 : b.id === 'org_user' ? 1 : a.name.localeCompare(b.name)));
}

export const hrEmployeeAdminRoutes = {
    'POST /api/org/hr/employees/setup': [
        orgRoute('hr.employees.setup', 'HRM.employees.manage', async (ctx) => {
            const users = await orgUsers(ctx.orgId);
            const totals = adminTotals(users);
            return {
                domain: ctx.domain,
                roles: await assignableRoles(ctx, users),
                adminPolicy: { ...totals, minimumActive: MIN_ACTIVE_ORG_ADMINS, maximum: MAX_ORG_ADMINS, canManage: ctx.role === 'org_super_admin' },
                missingNumbers: missingOf(users).length,
                format: 'EMP_00000',
            };
        }),
    ],

    'POST /api/org/hr/employees/create': [
        orgRoute('hr.employees.create', 'HRM.employees.manage', async (ctx) => {
            if (ctx.body.confirm !== true) throw new HttpError(400, 'Confirm the employee details and access before adding.');
            return withLock(ctx.orgId, LOCK, async () => {
                const users = await orgUsers(ctx.orgId);
                const inUse = new Set(users.map((u) => str(u.data.employeeNumber)).filter((x) => EMP_RE.test(x)));
                const out = await createOrgUser(ctx, ctx.body, (uid) => allocate(ctx.orgId, uid, inUse));
                await record(ctx, 'hr.employee.create', out.email, `${out.employeeNumber} added with role ${out.role}.`);
                return { uid: out.uid, employeeNumber: out.employeeNumber };
            });
        }),
    ],

    /** Employees without an EMP_ number, in the order numbers would be given (oldest registration first). */
    'POST /api/org/hr/employees/numbers': [
        orgRoute('hr.employees.numbers', 'HRM.employees.manage', async (ctx) => {
            const missing = missingOf(await orgUsers(ctx.orgId));
            return {
                missing: missing.slice(0, 500).map((u) => ({ uid: u.id, name: nameOf(u), email: str(u.data.email), registeredAt: str(u.data.createdAt), currentNumber: str(u.data.employeeNumber) })),
                count: missing.length,
            };
        }),
    ],

    'POST /api/org/hr/employees/numbers/assign': [
        orgRoute('hr.employees.numbers.assign', 'HRM.employees.manage', async (ctx) => {
            if (ctx.body.confirm !== true) throw new HttpError(400, 'Confirm assigning employee numbers.');
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10 || reason.length > 300) throw new HttpError(400, 'Give the reason (10 to 300 characters).');
            return withLock(ctx.orgId, LOCK, async () => {
                const users = await orgUsers(ctx.orgId);
                const inUse = new Set(users.map((u) => str(u.data.employeeNumber)).filter((x) => EMP_RE.test(x)));
                const missing = missingOf(users);
                const assigned: Array<{ email: string; employeeNumber: string }> = [];
                // Bounded per run so the lock is never held for long; run again for the rest.
                for (const u of missing.slice(0, 300)) {
                    const fresh = await getDoc(`users/${u.id}`);
                    if (!fresh || str(fresh.data.orgId) !== ctx.orgId || EMP_RE.test(str(fresh.data.employeeNumber))) continue;
                    const code = await allocate(ctx.orgId, u.id, inUse);
                    const legacy = str(fresh.data.employeeNumber);
                    const at = nowIso();
                    if (!(await writeDoc(`users/${u.id}`, { ...fresh.data, employeeNumber: code, employeeNumberAssignedAt: at, ...(legacy ? { legacyEmployeeNumber: legacy } : {}) }, { updateTime: fresh.updateTime }))) {
                        throw new HttpError(409, `${str(fresh.data.email)} changed while numbers were being assigned. Run it again; numbers already given are kept.`);
                    }
                    await record(ctx, 'hr.employee.number', str(fresh.data.email), `${code}${legacy ? ` (previously ${legacy})` : ''}`);
                    assigned.push({ email: str(fresh.data.email), employeeNumber: code });
                }
                await record(ctx, 'hr.employee_numbers.assign', 'Employee numbers', `${assigned.length} employee number(s) assigned by registration date. Reason: ${reason}`);
                return { assigned: assigned.length, remaining: Math.max(0, missing.length - 300), first: assigned[0]?.employeeNumber ?? '', last: assigned[assigned.length - 1]?.employeeNumber ?? '' };
            });
        }),
    ],
};
