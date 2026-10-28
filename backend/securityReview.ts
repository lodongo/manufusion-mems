import { HttpError, fieldEq, getDoc, isObj, listDocs, runQuery, str } from './core';
import { additionalRoleIds, effectiveAccess, orgRoute } from './guards';
import { queryAudit } from './audit';
import { allowedNodeIds } from './positions';
import { reviewPermissions, sensitiveKeys, sodConflicts } from './permissionPolicy';

// Read-only enterprise security inspection. No permissions, assignments or workflows
// are modified by these routes. Tenant identity always comes from orgRoute.
const values = (raw: unknown): string[] => (Array.isArray(raw) ? raw.map(str).filter(Boolean) : []);
const orgPath = (orgId: string, suffix: string) => 'organizations/' + orgId + '/' + suffix;
const securityAction = (action: string) =>
    /role|users?\.|security|scope|assign|password|tenant\.status|stocktake\.(approve|post)/i.test(action);

export const securityReviewRoutes = {
    'POST /api/org/security/overview': [
        orgRoute('org.security.overview', 'ADM.roles', async (ctx) => {
            const [users, roles, events] = await Promise.all([
                runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', ctx.orgId) }),
                listDocs(orgPath(ctx.orgId, 'roles')),
                queryAudit(250, ctx.orgId),
            ]);
            const roleIssues = roles.map((role) => {
                const review = reviewPermissions(values(role.data.permissions));
                return {
                    id: role.id,
                    name: str(role.data.name) || role.id,
                    leftovers: review.stale.length,
                    wildcard: review.wildcards.length + (values(role.data.permissions).includes('*') ? 1 : 0),
                    conflicts: sodConflicts(values(role.data.permissions)).length,
                };
            });
            const denials = events.filter((e) => e.outcome === 'denied');
            const reportedFailures = events.filter((e) => e.action === 'auth.login_attempt' && e.outcome !== 'success');
            const changes = events.filter((e) => securityAction(e.action) && e.source !== 'client');
            const byActor = new Map<string, number>();
            for (const e of denials) {
                const key = e.actorEmail || 'unknown';
                byActor.set(key, (byActor.get(key) || 0) + 1);
            }
            const repeatedDenials = [...byActor.entries()]
                .filter(([email, count]) => email !== 'anonymous' && count >= 5)
                .map(([email, count]) => ({ email, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);
            return {
                users: users
                    .map((u) => ({
                        uid: u.id,
                        name: [str(u.data.firstName), str(u.data.lastName)].filter(Boolean).join(' ') || str(u.data.email),
                        email: str(u.data.email),
                        role: str(u.data.role),
                        status: str(u.data.status) || 'active',
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .slice(0, 500),
                partialUsers: users.length > 500,
                summary: {
                    users: users.length,
                    disabledUsers: users.filter((u) => str(u.data.status) === 'disabled').length,
                    roles: roles.length,
                    rolesWithLeftovers: roleIssues.filter((r) => r.leftovers).length,
                    rolesWithWildcards: roleIssues.filter((r) => r.wildcard).length,
                    rolesWithPotentialConflicts: roleIssues.filter((r) => r.conflicts).length,
                    deniedRequestsInSample: denials.length,
                    reportedLoginFailuresInSample: reportedFailures.length,
                },
                roleIssues: roleIssues.filter((r) => r.leftovers || r.wildcard || r.conflicts).slice(0, 60),
                repeatedDenials,
                recentChanges: changes.slice(0, 25).map((e) => ({
                    id: e.id,
                    at: e.at,
                    action: e.action,
                    actor: e.actorEmail,
                    target: e.target,
                    outcome: e.outcome,
                    details: e.details,
                })),
                sampleSize: events.length,
                note: 'Security events are sampled from the latest 250 tenant audit entries; counts are not lifetime totals. Failed-login records are client reported, not independently verified login failures.',
            };
        }),
    ],
    'POST /api/org/security/inspect': [
        orgRoute('org.security.inspect', 'ADM.roles', async (ctx) => {
            const uid = str(ctx.body.uid);
            if (!/^[A-Za-z0-9]{6,128}$/.test(uid)) throw new HttpError(400, 'Invalid user identifier.');
            const user = await getDoc('users/' + uid);
            if (!user || str(user.data.orgId) !== ctx.orgId) {
                // Do not reveal the existence of accounts in other tenants.
                return { found: false };
            }
            const [access, roleDocs, positions, structure, scope] = await Promise.all([
                effectiveAccess(ctx.orgId, str(user.data.role) === 'org_admin' ? 'org_super_admin' : str(user.data.role), user),
                listDocs(orgPath(ctx.orgId, 'roles')),
                listDocs(orgPath(ctx.orgId, 'positions')),
                listDocs(orgPath(ctx.orgId, 'structure')),
                allowedNodeIds(ctx.orgId, user, true),
            ]);
            const roleMap = new Map(roleDocs.map((r) => [r.id, r]));
            const positionMap = new Map(positions.map((p) => [p.id, p]));
            const nodeMap = new Map(structure.map((n) => [n.id, n]));
            const nameAt = (id: string) => str(nodeMap.get(id)?.data.name) || str(nodeMap.get(id)?.data.code) || id;
            const assignments = (Array.isArray(user.data.assignments) ? user.data.assignments : [])
                .filter(isObj)
                .slice(0, 2)
                .map((a) => ({
                    type: str(a.type) || 'primary',
                    positionCode: str(a.positionCode),
                    jobTitle: str(positionMap.get(str(a.positionCode))?.data.title) || str(a.positionCode),
                    nodeId: str(a.nodeId),
                    location: nameAt(str(a.nodeId)),
                    startsOn: str(a.startsOn),
                    endsOn: str(a.endsOn),
                }));
            const directRoleId = str(user.data.role) === 'org_admin' ? 'org_super_admin' : str(user.data.role);
            const directRaw = directRoleId === 'org_super_admin' ? ['*'] : values(roleMap.get(directRoleId)?.data.permissions);
            const sources = [{
                roleId: directRoleId,
                roleName: access.roleName,
                how: 'Direct security role',
                location: 'Assigned organizational scope',
                permissions: access.directPermissions,
            }, ...access.grants.map((g) => ({
                roleId: g.roleId,
                roleName: g.roleName,
                how: 'Job role ' + g.positionCode,
                location: nameAt(g.nodeId),
                permissions: g.permissions,
            }))];
            const rawPermissions = [
                ...directRaw,
                ...additionalRoleIds(user).flatMap((id) => values(roleMap.get(id)?.data.permissions)),
                ...access.grants.flatMap((g) => values(roleMap.get(g.roleId)?.data.permissions)),
            ];
            const review = reviewPermissions(rawPermissions);
            const extras = values(user.data.extraScopes);
            const sensitive = new Set(sensitiveKeys());
            return {
                found: true,
                user: {
                    uid: user.id,
                    name: [str(user.data.firstName), str(user.data.lastName)].filter(Boolean).join(' ') || str(user.data.email),
                    email: str(user.data.email),
                    status: str(user.data.status) || 'active',
                    roleId: directRoleId,
                    roleName: access.roleName,
                    expiresAt: str(user.data.roleExpiresAt),
                    expired: access.expired,
                },
                assignments,
                sources,
                permissions: access.permissions.slice().sort(),
                sensitivePermissions: access.permissions.filter((p) => sensitive.has(p)).sort(),
                scope: {
                    view: directRoleId === 'org_super_admin' ? 'Whole organization (super administrator)' : scope === 'all' ? 'Whole organization (read-only extras included)' : String(scope.size) + ' organizational locations',
                    extraViewLocations: extras.map(nameAt),
                },
                review: {
                    potentialConflicts: sodConflicts(access.permissions).map((c) => ({ id: c.id, why: c.why })),
                    legacyKeys: review.stale.map((s) => s.key),
                    wildcardKeys: [...new Set([...review.wildcards, ...rawPermissions.filter((p) => p === '*')])],
                },
            };
        }),
    ],
};
