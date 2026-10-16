import { isObj, listDocs, str } from './core';
import { queryAudit } from './audit';
import { hasPerm, orgRoute } from './guards';
import { enabledModules, orgUsers } from './org';
import { docStatus, reviewPermissions, sodConflicts } from './permissionPolicy';
import { col } from './structure';

// Organization admin home: one read-only summary for the administration entry page.
// Each block is returned only when the person holds the matching administration right.

const DAY = 86_400_000;
const asList = (value: unknown): string[] => (Array.isArray(value) ? (value as unknown[]).map(str).filter(Boolean) : []);
const ts = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
};

export const orgHomeRoutes = {
    'POST /api/org/home/admin': [
        orgRoute('org.home.admin', null, async (ctx) => {
            const can = (p: string) => ctx.role === 'org_super_admin' || hasPerm(ctx.permissions, p);
            const now = Date.now();
            const today = new Date(now).toISOString().slice(0, 10);
            const soon = new Date(now + 30 * DAY).toISOString().slice(0, 10);
            const root = `organizations/${ctx.orgId}`;
            const out: Record<string, unknown> = {};
            const isAdmin = ['ADM.users', 'ADM.roles', 'ADM.structure', 'ADM.workflows', 'ADM.audit', 'ADM.modules', 'ADM.settings'].some(can);
            if (!isAdmin) return out;

            const [users, positions, nodes, roleDocs, registry, modules, docs] = await Promise.all([
                orgUsers(ctx.orgId),
                listDocs(`${root}/positions`),
                listDocs(col(ctx.orgId)),
                listDocs(`${root}/roles`),
                listDocs(`${root}/workflow_registry`),
                enabledModules(ctx.org),
                listDocs(`${root}/role_docs`),
            ]);

            const active = users.filter((u) => str(u.data.status) !== 'disabled');
            const lastLogin = (u: (typeof users)[number]) => ts(str(u.data.lastLoginAt));

            if (can('ADM.users')) {
                out.users = {
                    total: users.length,
                    active: active.length,
                    disabled: users.length - active.length,
                    superAdmins: active.filter((u) => ['org_super_admin', 'org_admin'].includes(str(u.data.role))).length,
                    neverSignedIn: active.filter((u) => !lastLogin(u)).length,
                    inactive30: active.filter((u) => lastLogin(u) && now - lastLogin(u) > 30 * DAY).length,
                    active7: active.filter((u) => lastLogin(u) && now - lastLogin(u) <= 7 * DAY).length,
                    rolesExpiring: active.filter((u) => str(u.data.roleExpiresAt) && str(u.data.roleExpiresAt) >= today && str(u.data.roleExpiresAt) <= soon).length,
                    rolesExpired: active.filter((u) => str(u.data.roleExpiresAt) && str(u.data.roleExpiresAt) < today).length,
                    withoutJobRole: active.filter((u) => !['org_super_admin', 'org_admin'].includes(str(u.data.role)) && !(Array.isArray(u.data.assignments) && u.data.assignments.length)).length,
                };
            }

            if (can('ADM.roles')) {
                const mapped = new Set(positions.flatMap((p) => asList(p.data.securityRoles)));
                const held = new Set(users.map((u) => str(u.data.role)));
                const docById = new Map(docs.map((d) => [d.id, d.data]));
                const custom = roleDocs.filter((r) => r.id !== 'org_super_admin' && r.id !== 'default_security');
                const state = custom.map((r) => {
                    const perms = asList(r.data.permissions);
                    return { stale: reviewPermissions(perms).stale.length, conflicts: sodConflicts(perms).length, doc: docStatus(docById.get(r.id), perms, today), unused: !mapped.has(r.id) && !held.has(r.id) };
                });
                out.access = {
                    roles: custom.length,
                    withLeftovers: state.filter((s) => s.stale).length,
                    withConflicts: state.filter((s) => s.conflicts).length,
                    undocumented: state.filter((s) => s.doc === 'missing').length,
                    docsOutdated: state.filter((s) => s.doc === 'outdated').length,
                    unused: state.filter((s) => s.unused).length,
                };
            }

            if (can('ADM.structure')) {
                const levels = new Map<string, number>();
                for (const n of nodes) levels.set(str(n.data.level), (levels.get(str(n.data.level)) ?? 0) + 1);
                out.design = {
                    units: nodes.length,
                    sites: levels.get('site') ?? 0,
                    jobRoles: positions.length,
                    jobRolesWithoutSecurityRole: positions.filter((p) => !asList(p.data.securityRoles).length).length,
                    jobRolesWithFewSkills: positions.filter((p) => asList(p.data.coreSkills).length < 5).length,
                    shortCodes: positions.filter((p) => !/^ROL_\d{6}$/.test(p.id)).length,
                };
            }

            if (can('ADM.workflows')) {
                out.workflows = { configured: registry.length, enabled: registry.filter((w) => w.data.enabled === true).length };
            }

            if (can('ADM.audit')) {
                const events = await queryAudit(300, ctx.orgId).catch(() => []);
                const day = events.filter((e) => now - ts(e.at) <= DAY);
                const week = events.filter((e) => now - ts(e.at) <= 7 * DAY);
                const byArea = new Map<string, number>();
                for (const e of week) {
                    const area = e.action.split('.')[1];
                    if (area && e.category !== 'auth') byArea.set(area, (byArea.get(area) ?? 0) + 1);
                }
                out.security = {
                    sample: events.length,
                    since: events.length ? events[events.length - 1].at : '',
                    denied24h: day.filter((e) => e.outcome === 'denied').length,
                    failed24h: day.filter((e) => e.outcome === 'failure').length,
                    events24h: day.length,
                    recentDenied: events.filter((e) => e.outcome === 'denied').slice(0, 5).map((e) => ({ at: e.at, action: e.action, who: e.actorEmail, details: e.details.slice(0, 160) })),
                    recentChanges: events
                        .filter((e) => /^org\.(role|user|position|positions|roles|structure)\./.test(e.action) && e.outcome !== 'denied')
                        .slice(0, 6)
                        .map((e) => ({ at: e.at, action: e.action, target: e.target, who: e.actorEmail })),
                };
                out.usage = {
                    byArea: [...byArea.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([area, count]) => ({ area, count })),
                };
            }

            const branding = ctx.org.data.branding;
            const secured = positions.some((p) => asList(p.data.securityRoles).length);
            const assigned = users.some((u) => Array.isArray(u.data.assignments) && u.data.assignments.length);
            out.setup = {
                items: [
                    { key: 'users', label: 'Add your team', done: users.length > 1, path: 'organization_admin/users' },
                    { key: 'design', label: 'Build the organization design (at least one site)', done: nodes.some((n) => str(n.data.level) === 'site'), path: 'organization_admin/structure' },
                    { key: 'jobroles', label: 'Create job roles', done: positions.length > 0, path: 'organization_admin/positions' },
                    { key: 'mapping', label: 'Map job roles to security roles', done: secured, path: 'organization_admin/positions' },
                    { key: 'assign', label: 'Assign job roles to people', done: assigned, path: 'organization_admin/users' },
                    { key: 'workflows', label: 'Configure and enable approval workflows', done: registry.some((w) => w.data.enabled === true), path: 'organization_admin/workflows' },
                    { key: 'branding', label: 'Set your branding', done: isObj(branding) && Object.keys(branding).length > 0, path: 'organization_admin/branding' },
                ],
                modules: modules.length,
            };
            return out;
        }),
    ],
};
