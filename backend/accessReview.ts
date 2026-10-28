import { HttpError, deleteDoc, listDocs, nowIso, randomId, str, writeDoc } from './core';
import { clearAccessCache, directRoleIds, orgRoute, type OrgContext } from './guards';
import { canGrant, catalogue, enabledModules, orgUsers, record } from './org';
import { LEVEL_ROLE_IDS } from './levelRoles';
import { BUILT_MODULE_CODES, BUILT_PERMISSIONS, ROLE_TEMPLATES, reviewPermissions, sodConflicts, type StaleKey } from './permissionPolicy';

// ---------------------------------------------------------------------------
// Access review: shows which security-role permissions are real, which are leftovers, and which roles combine
// duties that must stay apart. Cleanup is explicit (super admin, with a reason), recomputed on the server, audited
// per role with before and after, and never deletes a role that anyone uses.
// Recommended roles are created only on request and stay editable.
// ---------------------------------------------------------------------------

interface RolePlan {
    id: string;
    name: string;
    system: boolean;
    users: number;
    jobRoles: string[];
    before: string[];
    after: string[];
    stale: StaleKey[];
    wildcards: string[];
    inactive: string[];
    conflicts: Array<{ id: string; why: string }>;
    changed: boolean;
    deletable: boolean;
}

const asList = (value: unknown): string[] => (Array.isArray(value) ? (value as unknown[]).map(str).filter(Boolean) : []);

async function buildPlan(ctx: OrgContext) {
    const [roleDocs, users, positions, groups, modules] = await Promise.all([
        listDocs(`organizations/${ctx.orgId}/roles`),
        orgUsers(ctx.orgId),
        listDocs(`organizations/${ctx.orgId}/positions`),
        catalogue(ctx.org),
        enabledModules(ctx.org),
    ]);
    const offered = new Set(groups.flatMap((g) => g.permissions.map((p) => p.key)));
    const userCount = new Map<string, number>();
    // A role is in use if anyone holds it directly, as primary or additional role.
    for (const u of users) for (const r of directRoleIds(u)) userCount.set(r, (userCount.get(r) ?? 0) + 1);
    const mapped = new Map<string, string[]>();
    for (const p of positions) for (const r of asList(p.data.securityRoles)) mapped.set(r, [...(mapped.get(r) ?? []), p.id]);

    const roles: RolePlan[] = roleDocs
        .filter((d) => d.id !== 'org_super_admin')
        .map((d) => {
            const before = asList(d.data.permissions);
            const reviewed = reviewPermissions(before);
            const after = reviewed.after;
            const system = d.data.system === true || d.id === 'default_security';
            const used = userCount.get(d.id) ?? 0;
            const jobRoles = mapped.get(d.id) ?? [];
            const sortedBefore = [...new Set(before)].sort();
            const changed = after.length !== before.length || after.some((x, i) => x !== sortedBefore[i]);
            return {
                id: d.id,
                name: str(d.data.name) || d.id,
                system,
                users: used,
                jobRoles,
                before,
                after,
                stale: reviewed.stale,
                wildcards: reviewed.wildcards,
                inactive: reviewed.keep.filter((k) => !offered.has(k)),
                conflicts: sodConflicts(after).map((c) => ({ id: c.id, why: c.why })),
                changed,
                deletable: !system && used === 0 && jobRoles.length === 0 && after.length === 0,
            };
        })
        .sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name));

    const built = modules.filter((m) => BUILT_PERMISSIONS[m.code]?.length).map((m) => ({ code: m.code, name: m.name, permissions: BUILT_PERMISSIONS[m.code].length }));
    const notBuilt = modules.filter((m) => m.code !== 'ADM' && !BUILT_PERMISSIONS[m.code]?.length).map((m) => ({ code: m.code, name: m.name }));
    const notAdopted = BUILT_MODULE_CODES.filter((c) => !modules.some((m) => m.code === c));
    const summary = {
        roles: roles.length,
        rolesWithLeftovers: roles.filter((r) => r.stale.length).length,
        leftoverPermissions: roles.reduce((n, r) => n + r.stale.length, 0),
        rolesWithConflicts: roles.filter((r) => r.conflicts.length).length,
        wildcardRoles: roles.filter((r) => r.wildcards.length).length,
        deletableRoles: roles.filter((r) => r.deletable).length,
    };
    return { roles, summary, built, notBuilt, notAdopted };
}

function requireSuperAdmin(ctx: OrgContext) {
    if (ctx.role !== 'org_super_admin') throw new HttpError(403, 'Only a super admin can do this.');
}

export const accessReviewRoutes = {
    'POST /api/org/roles/review': [orgRoute('org.roles.review', 'ADM.roles', async (ctx) => ({ ...(await buildPlan(ctx)), canCleanup: ctx.role === 'org_super_admin' }))],

    'POST /api/org/roles/cleanup': [
        orgRoute('org.roles.cleanup', 'ADM.roles', async (ctx) => {
            requireSuperAdmin(ctx);
            if (ctx.body.confirm !== true) throw new HttpError(400, 'Confirm the cleanup to continue.');
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10 || reason.length > 300) throw new HttpError(400, 'Give the reason for the cleanup (10 to 300 characters).');
            const deleteUnused = ctx.body.deleteUnused === true;
            const plan = await buildPlan(ctx);
            const docs = new Map((await listDocs(`organizations/${ctx.orgId}/roles`)).map((d) => [d.id, d]));
            let updated = 0;
            let removedKeys = 0;
            let deleted = 0;
            for (const role of plan.roles) {
                const doc = docs.get(role.id);
                if (!doc) continue;
                if (deleteUnused && role.deletable) {
                    await deleteDoc(`organizations/${ctx.orgId}/roles/${role.id}`);
                    await record(ctx, 'org.role.cleanup.delete', role.name, `Unused role with no usable permissions removed. Reason: ${reason}`);
                    deleted++;
                    continue;
                }
                if (!role.changed) continue;
                await writeDoc(`organizations/${ctx.orgId}/roles/${role.id}`, { ...doc.data, permissions: role.after, updatedAt: nowIso(), updatedBy: ctx.uid });
                const gone = role.before.filter((k) => !role.after.includes(k));
                const gained = role.after.filter((k) => !role.before.includes(k));
                await record(ctx, 'org.role.cleanup.update', role.name, `Removed: ${gone.join(', ') || 'none'}. Added (exact equivalents): ${gained.join(', ') || 'none'}. Reason: ${reason}`.slice(0, 1800));
                updated++;
                removedKeys += gone.length;
            }
            await record(ctx, 'org.roles.cleanup', 'Security roles', `${updated} roles updated, ${removedKeys} permissions removed, ${deleted} unused roles deleted. Reason: ${reason}`);
            clearAccessCache(ctx.orgId);
            return { ok: true, updated, removedPermissions: removedKeys, deleted };
        }),
    ],

    'POST /api/org/roles/templates': [
        orgRoute('org.roles.templates', 'ADM.roles', async (ctx) => {
            const [roles, groups] = await Promise.all([listDocs(`organizations/${ctx.orgId}/roles`), catalogue(ctx.org)]);
            const names = new Set(roles.map((r) => str(r.data.name).toLowerCase()));
            const enabled = new Set(groups.map((g) => g.module));
            return {
                templates: ROLE_TEMPLATES.map((t) => ({
                    id: t.id,
                    module: t.module,
                    name: t.name,
                    description: t.description,
                    permissions: t.permissions,
                    exists: names.has(t.name.toLowerCase()),
                    moduleAdopted: enabled.has(t.module),
                    grantable: canGrant(ctx, t.permissions),
                    conflicts: sodConflicts(t.permissions).length,
                })),
            };
        }),
    ],

    'POST /api/org/roles/templates/apply': [
        orgRoute('org.roles.templates.apply', 'ADM.roles', async (ctx) => {
            const ids = Array.from(new Set((Array.isArray(ctx.body.ids) ? ctx.body.ids : []).map(str))).slice(0, 30);
            if (!ids.length) throw new HttpError(400, 'Choose at least one recommended role.');
            const [roles, groups] = await Promise.all([listDocs(`organizations/${ctx.orgId}/roles`), catalogue(ctx.org)]);
            const names = new Set(roles.map((r) => str(r.data.name).toLowerCase()));
            const offered = new Set(groups.flatMap((g) => g.permissions.map((p) => p.key)));
            const baseline = roles.find((r) => r.id === 'default_security');
            const inherited = asList(baseline?.data.permissions).filter((k) => offered.has(k));
            const created: string[] = [];
            const skipped: Array<{ id: string; reason: string }> = [];
            let count = roles.filter((r) => !LEVEL_ROLE_IDS.has(r.id)).length;
            for (const id of ids) {
                const t = ROLE_TEMPLATES.find((x) => x.id === id);
                if (!t) {
                    skipped.push({ id, reason: 'Unknown recommended role.' });
                    continue;
                }
                const permissions = Array.from(new Set([...inherited, ...t.permissions.filter((k) => offered.has(k))]));
                if (!groups.some((g) => g.module === t.module)) skipped.push({ id, reason: `${t.module} is not adopted by your organization.` });
                else if (names.has(t.name.toLowerCase())) skipped.push({ id, reason: 'A role with this name already exists.' });
                else if (count >= 100) skipped.push({ id, reason: 'An organization can have up to 100 roles.' });
                else if (!canGrant(ctx, permissions)) skipped.push({ id, reason: 'It carries rights you do not hold yourself.' });
                else if (sodConflicts(permissions).length) skipped.push({ id, reason: 'Combined with the default baseline it would break segregation of duties.' });
                else {
                    const now = nowIso();
                    await writeDoc(`organizations/${ctx.orgId}/roles/role_${randomId(6)}`, { name: t.name, description: t.description, permissions, system: false, template: t.id, createdAt: now, updatedAt: now, createdBy: ctx.uid });
                    await record(ctx, 'org.role.create', t.name, `From recommended role ${t.id}: ${permissions.join(', ')}`.slice(0, 1800));
                    names.add(t.name.toLowerCase());
                    count++;
                    created.push(t.name);
                }
            }
            return { created, skipped };
        }),
    ],
};
