import {
    EMAIL_LOCAL_RE,
    HttpError,
    checkPassword,
    createAuthUser,
    deleteAuthUser,
    deleteDoc,
    fieldEq,
    getDoc,
    isObj,
    listDocs,
    nowIso,
    num,
    phoneE164,
    randomId,
    revokeTokens,
    runQuery,
    str,
    text,
    updateAuthUser,
    updateFields,
    writeDoc,
    type Doc,
} from './core';
import { audit, queryAudit } from './audit';
import { clearAccessCache, ensureOrgCode, hasPerm, loadRole, orgRoute, type OrgContext } from './guards';
import { SOD_RULES, buildCatalogue, docStatus, reviewPermissions, sensitiveKeys, sodConflicts } from './permissionPolicy';
import { adminTotals, guardedAdminChange, isOrgAdmin, MAX_ORG_ADMINS, MIN_ACTIVE_ORG_ADMINS } from './adminRoster';
import { signedUrl } from './structure';
import { standardRoleTemplates } from './standardRoleTemplates';

// ---------------------------------------------------------------------------
// Roles and permissions model
//   organizations/{orgId}/roles/{roleId}  { name, description, permissions[], system }
//   users/{uid}                           { orgId, role }
// Permission keys: "<MODULE>.<action>" e.g. AST.approve, or ADM.<area>. The keys an organization can hand out are
// defined in permissionPolicy.ts: only rights that code enforces are ever offered.
// ---------------------------------------------------------------------------

export const ORG_SYSTEM_ROLES: Record<string, { name: string; description: string; permissions: string[] }> = {
    org_super_admin: {
        name: 'Organization super admin',
        description: 'Full access to everything in the organization. Given to the person who registered it.',
        permissions: ['*'],
    },
    org_user: {
        name: 'Standard user',
        description: 'Permanent basic employee self-service access. Higher business permissions come from separately assigned roles.',
        permissions: [],
    },
};

export async function seedOrgRoles(orgId: string): Promise<void> {
    const now = nowIso();
    for (const [id, role] of Object.entries(ORG_SYSTEM_ROLES)) {
        await writeDoc(`organizations/${orgId}/roles/${id}`, { ...role, system: true, createdAt: now, updatedAt: now });
    }
}

export async function enabledModules(org: Doc) {
    const map = isObj(org.data.modules) ? org.data.modules : {};
    return (await listDocs('modules'))
        .map((d) => ({
            code: d.id,
            name: str(d.data.name),
            category: str(d.data.category),
            mandatory: d.data.mandatory === true,
            available: d.data.enabled === true,
            sortOrder: num(d.data.sortOrder) ?? 100,
            features: Array.isArray(d.data.features) ? d.data.features.map(str) : [],
        }))
        .filter((m) => m.mandatory || (m.available && map[m.code] === true))
        .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Permission groups this organization can hand out: administration plus every adopted module that has working screens. */
export async function catalogue(org: Doc) {
    return buildCatalogue(await enabledModules(org));
}

const isSuperRole = (role: string) => role === 'org_super_admin' || role === 'org_admin';

/** Non-super admins can only hand out rights they hold themselves (prevents privilege escalation). */
export function canGrant(ctx: OrgContext, permissions: string[]): boolean {
    if (ctx.role === 'org_super_admin') return true;
    // Only rights held through the person's own direct security role count; job-role rights are bound to places.
    return permissions.every((p) => p !== '*' && hasPerm(ctx.directPermissions, p));
}

/** A role that combines duties which must stay apart can only be saved with an acknowledged reason (audited). */
function requireSodAcknowledgement(raw: Record<string, unknown>, permissions: string[]): string {
    const conflicts = sodConflicts(permissions);
    if (!conflicts.length) return '';
    const acknowledged = new Set((Array.isArray(raw.acknowledgeSod) ? raw.acknowledgeSod : []).map(str));
    const reason = str(raw.sodReason).trim();
    if (!conflicts.every((c) => acknowledged.has(c.id)) || reason.length < 10 || reason.length > 300) {
        throw new HttpError(409, `Segregation of duties: ${conflicts.map((c) => c.why).join(' ')} Acknowledge each conflict and give a reason of at least 10 characters to save this role.`);
    }
    return ` SoD acknowledged (${conflicts.map((c) => c.id).join(', ')}): ${reason}`;
}

function userOut(doc: Doc) {
    const d = doc.data;
    return {
        uid: doc.id,
        email: str(d.email),
        title: str(d.title),
        firstName: str(d.firstName),
        lastName: str(d.lastName),
        phone: str(d.phone),
        role: str(d.role) === 'org_admin' ? 'org_super_admin' : str(d.role),
        status: str(d.status) || 'active',
        roleExpiresAt: str(d.roleExpiresAt),
        secondaryAssignment: Array.isArray(d.assignments) && d.assignments.length > 1 ? d.assignments[1] : null,
        jobRoles: (Array.isArray(d.assignments) ? (d.assignments as unknown[]) : []).filter(isObj).map((a) => str(a.positionCode)).filter(Boolean),
        createdAt: str(d.createdAt),
        lastLoginAt: str(d.lastLoginAt),
    };
}

export async function orgUsers(orgId: string): Promise<Doc[]> {
    return runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', orgId) });
}

async function assignableRole(ctx: OrgContext, role: string): Promise<void> {
    const roles = new Set((await listDocs(`organizations/${ctx.orgId}/roles`)).map((d) => d.id));
    if (!roles.has(role)) throw new HttpError(400, 'Choose a role from the list.');
    if (role === 'org_super_admin' && ctx.role !== 'org_super_admin') throw new HttpError(403, 'Only a super admin can assign the super admin role.');
    const loaded = await loadRole(ctx.orgId, role);
    if (!canGrant(ctx, loaded.permissions)) throw new HttpError(403, 'You cannot assign a role with more rights than your own.');
}

export function record(ctx: OrgContext, action: string, target: string, details = '') {
    return audit([{ category: 'data', action, actor: ctx.actor, meta: ctx.meta, target: { label: target }, details, orgId: ctx.orgId }]);
}

async function getOrgUser(ctx: OrgContext, uid: string): Promise<Doc> {
    const target = /^[A-Za-z0-9]{6,128}$/.test(uid) ? await getDoc(`users/${uid}`) : null;
    if (!target || str(target.data.orgId) !== ctx.orgId) throw new HttpError(404, 'User not found.');
    return target;
}

export const orgRoutes = {
    'POST /api/org/context': [
        orgRoute('org.context', null, async (ctx) => {
            const [modules, users, code] = await Promise.all([enabledModules(ctx.org), orgUsers(ctx.orgId), ensureOrgCode(ctx.org)]);
            const d = ctx.org.data;
            return {
                organization: {
                    id: ctx.orgId,
                    code,
                    name: str(d.name),
                    domain: ctx.domain,
                    countryName: str(d.countryName),
                    city: str(d.city),
                    currencyCode: str(d.currencyCode),
                    industry: str(d.industry),
                    companySize: str(d.companySize),
                    legalEntityType: str(d.legalEntityType),
                    status: str(d.status),
                    createdAt: str(d.createdAt),
                },
                role: ctx.role,
                roleName: ctx.roleName,
                permissions: ctx.permissions,
                access: {
                    direct: ctx.directPermissions,
                    roleExpiresAt: str(ctx.me.data.roleExpiresAt),
                    grants: ctx.grants.map((g) => ({ positionCode: g.positionCode, nodeId: g.nodeId, roleId: g.roleId, roleName: g.roleName, permissions: g.permissions.length })),
                },
                modules: modules.map((m) => ({ code: m.code, name: m.name, category: m.category, mandatory: m.mandatory, features: m.features })),
                userCount: users.length,
                activeUserCount: users.filter((u) => str(u.data.status) !== 'disabled').length,
            };
        }),
    ],

    'POST /api/org/users/list': [
        orgRoute('org.users.list', 'ADM.users', async (ctx) => {
            const records = await orgUsers(ctx.orgId);
            // User photos are private files. Sign only a path belonging to the
            // listed user's own profile or original registration application.
            const users = await Promise.all(records.map(async (user) => {
                const path = str(user.data.photoPath);
                const owner = user.id;
                const isOwnedPhoto = (
                    path.startsWith('users/' + owner + '/photo_')
                    || path.startsWith('applications/' + owner + '/photo_')
                ) && /^photo_[A-Za-z0-9_-]+\.(?:png|jpe?g)$/i.test(path.split('/').pop() || '');
                return {
                    ...userOut(user),
                    skillCodes: (Array.isArray(user.data.skillCodes) ? user.data.skillCodes : []).map(str),
                    isCreator: user.id === str(ctx.org.data.createdBy),
                    photoUrl: isOwnedPhoto ? await signedUrl(path) : '',
                };
            }));
            const totals = adminTotals(records);
            return {
                users: users.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
                domain: ctx.domain,
                adminPolicy: { ...totals, minimumActive: MIN_ACTIVE_ORG_ADMINS, maximum: MAX_ORG_ADMINS, canManage: ctx.role === 'org_super_admin' },
            };
        }),
    ],

    // Employee skills are selections from the active HRM Skills Master, independent of access permissions.
    'POST /api/org/users/create': [
        orgRoute('org.users.create', 'ADM.users', async (ctx) => {
            const { body } = ctx;
            if (!ctx.domain) throw new HttpError(400, 'Your organization has no email extension on record.');
            const local = str(body.emailLocal).trim().toLowerCase();
            if (!EMAIL_LOCAL_RE.test(local)) throw new HttpError(400, 'Enter a valid email ID using letters, numbers, dots, dashes or underscores.');
            const email = `${local}@${ctx.domain}`;
            const firstName = text(body, 'firstName', 1, 40, 'Enter the first name.');
            const lastName = text(body, 'lastName', 1, 40, 'Enter the last name.');
            const phone = phoneE164(body.phone);
            const role = str(body.role) || 'org_user';
            await assignableRole(ctx, role);
            const skillsDoc = await getDoc('module_workspaces/HRM/metadata/skillsMaster');
            const activeSkills = new Set((Array.isArray(skillsDoc?.data.items) ? skillsDoc.data.items : [])
                .filter(isObj).filter(item => item.active !== false).map(item => str(item.code)));
            const submittedSkills = Array.isArray(body.skillCodes) ? body.skillCodes.map(str) : [];
            const skillCodes = [...new Set(submittedSkills)];
            if (skillCodes.length > 250 || skillCodes.some(code => !activeSkills.has(code))) throw new HttpError(400, 'Choose employee skills from the active HRM Skills Master.');
            const password = str(body.password);
            checkPassword(password);
            const uid = await createAuthUser({ email, password, displayName: `${firstName} ${lastName}`, phoneNumber: phone });
            try {
                const createdAt = nowIso();
                const record = {
                    uid, email, firstName, lastName, phone, role, skillCodes, status: 'active', orgId: ctx.orgId,
                    createdAt, createdBy: ctx.uid, lastLoginAt: '', mustChangePassword: true,
                    passwordChangeRequiredAt: createdAt,
                };
                if (isOrgAdmin(role)) {
                    await guardedAdminChange(ctx, { action: 'create', uid, fields: record });
                } else {
                    await writeDoc(`users/${uid}`, record);
                }
            } catch (err) {
                await deleteAuthUser(uid);
                throw err;
            }
            await record(ctx, isOrgAdmin(role) ? 'org.admin.grant.create' : 'org.user.create', email, `Role: ${role}`);
            return { uid };
        }),
    ],

    'POST /api/org/users/update': [
        orgRoute('org.users.update', 'ADM.users', async (ctx) => {
            const { body } = ctx;
            const uid = str(body.uid);
            const target = await getOrgUser(ctx, uid);
            const firstName = text(body, 'firstName', 1, 40, 'Enter the first name.');
            const lastName = text(body, 'lastName', 1, 40, 'Enter the last name.');
            const phone = phoneE164(body.phone);
            const role = str(body.role);
            const skillsDoc = await getDoc('module_workspaces/HRM/metadata/skillsMaster');
            const activeSkills = new Set((Array.isArray(skillsDoc?.data.items) ? skillsDoc.data.items : [])
                .filter(isObj).filter(item => item.active !== false).map(item => str(item.code)));
            const previousSkills = (Array.isArray(target.data.skillCodes) ? target.data.skillCodes : []).map(str);
            const submittedSkills = Array.isArray(body.skillCodes) ? body.skillCodes.map(str) : previousSkills;
            const skillCodes = [...new Set(submittedSkills)];
            if (skillCodes.length > 250 || skillCodes.some(code => !activeSkills.has(code) && !previousSkills.includes(code))) throw new HttpError(400, 'Choose employee skills from the HRM Skills Master.');
            const status = str(body.status) === 'disabled' ? 'disabled' : 'active';
            const roleExpiresAt = str(body.roleExpiresAt);
            if (roleExpiresAt && (!/^\d{4}-\d{2}-\d{2}$/.test(roleExpiresAt) || Number.isNaN(Date.parse(`${roleExpiresAt}T00:00:00Z`)))) throw new HttpError(400, 'Enter a valid expiry date.');
            const currentExpiry = str(target.data.roleExpiresAt);
            const currentRole = str(target.data.role) === 'org_admin' ? 'org_super_admin' : str(target.data.role);
            const currentStatus = str(target.data.status) || 'active';
            if (uid === str(ctx.org.data.createdBy) && (role !== 'org_super_admin' || status === 'disabled')) {
                throw new HttpError(403, 'The original organization creator must remain an active organization super administrator.');
            }
            if (uid === ctx.uid && (role !== currentRole || status === 'disabled')) throw new HttpError(400, 'You cannot change your own role or disable your own account.');
            if (currentRole === 'org_super_admin' && ctx.role !== 'org_super_admin') throw new HttpError(403, 'Only a super admin can change super admin accounts.');
            if (role !== currentRole) await assignableRole(ctx, role);
            if (isOrgAdmin(role) && roleExpiresAt) throw new HttpError(400, 'The organization super administrator role cannot expire.');
            if (roleExpiresAt !== currentExpiry) {
                if (role === 'org_super_admin' && roleExpiresAt) throw new HttpError(400, 'The super admin role cannot expire.');
                if (uid === ctx.uid) throw new HttpError(400, 'You cannot change the expiry of your own role.');
                if (roleExpiresAt && roleExpiresAt < new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'The expiry date cannot be in the past.');
                if (!canGrant(ctx, (await loadRole(ctx.orgId, role)).permissions)) throw new HttpError(403, 'You cannot extend a role with more rights than your own.');
            }
            const revoke = role !== currentRole || status !== currentStatus;
            const now = nowIso();
            const patch = {
                firstName,
                lastName,
                phone,
                role,
                skillCodes,
                status,
                roleExpiresAt: role === 'org_super_admin' ? '' : roleExpiresAt,
                updatedAt: now,
                updatedBy: ctx.uid,
                ...(revoke ? { tokensValidAfter: now } : {}),
            };
            const adminMembershipChange = revoke && (isOrgAdmin(currentRole) || isOrgAdmin(role));
            const changes: Record<string, unknown> = { displayName: `${firstName} ${lastName}`, disableUser: status === 'disabled' };
            if (phone !== str(target.data.phone)) changes.phoneNumber = phone;
            if (adminMembershipChange) {
                // An atomic roster/version check prevents concurrent requests exceeding
                // the administrator cap or simultaneously disabling the final admin.
                await guardedAdminChange(ctx, { action: 'update', uid, fields: patch, expected: target });
                try {
                    await updateAuthUser(uid, changes);
                    await revokeTokens(uid);
                } catch (err) {
                    await record(ctx, 'org.admin.auth_sync_failed', str(target.data.email), 'Administrator rights changed; Firebase Auth synchronization requires attention.');
                    throw new HttpError(503, 'Administrator permissions were updated but sign-in synchronization needs attention. Refresh the user and retry saving.');
                }
            } else {
                await updateAuthUser(uid, changes);
                if (revoke) await revokeTokens(uid);
                await writeDoc(`users/${uid}`, { ...target.data, ...patch });
            }
            await record(ctx, role !== currentRole ? 'org.admin.role_change' : 'org.user.update', str(target.data.email),
                `Role: ${currentRole} to ${role}; status: ${currentStatus} to ${status}${roleExpiresAt ? `, role expires ${roleExpiresAt}` : ''}`);
            clearAccessCache(ctx.orgId);
            return { ok: true };
        }),
    ],

    'POST /api/org/users/delete': [
        orgRoute('org.users.delete', 'ADM.users', async (ctx) => {
            const uid = str(ctx.body.uid);
            if (uid === ctx.uid) throw new HttpError(400, 'You cannot delete your own account.');
            if (uid === str(ctx.org.data.createdBy)) throw new HttpError(403, 'The original organization creator cannot be deleted or removed as super administrator.');
            const target = await getOrgUser(ctx, uid);
            if (isSuperRole(str(target.data.role))) {
                if (ctx.role !== 'org_super_admin') throw new HttpError(403, 'Only a super admin can delete super admin accounts.');
                await guardedAdminChange(ctx, { action: 'delete', uid, expected: target });
                try {
                    await deleteAuthUser(uid, true);
                } catch {
                    await record(ctx, 'org.admin.auth_cleanup_pending', str(target.data.email), 'User record removed; Firebase Auth deletion requires follow-up.');
                    throw new HttpError(503, 'The account was removed from MEMS but Firebase sign-in cleanup needs attention. Contact MEMS support.');
                }
            } else {
                await deleteAuthUser(uid, true);
                await deleteDoc(`users/${uid}`);
            }
            await record(ctx, 'org.user.delete', str(target.data.email));
            return { ok: true };
        }),
    ],

    // Organization admin adopts vetted transaction roles without manual permission binding.
    'POST /api/org/roles/templates': [
        orgRoute('org.roles.templates', 'ADM.roles', async (ctx) => {
            const templates = standardRoleTemplates(await catalogue(ctx.org));
            const existing = new Set((await listDocs(`organizations/${ctx.orgId}/roles`)).map(r => r.id));
            return { templates: templates.map(t => ({
                ...t, exists: existing.has(t.id), moduleAdopted: true, grantable: canGrant(ctx, t.permissions), conflicts: sodConflicts(t.permissions).length,
            })) };
        }),
    ],

    'POST /api/org/roles/templates/apply': [
        orgRoute('org.roles.templates.apply', 'ADM.roles', async (ctx) => {
            if (ctx.role !== 'org_super_admin') throw new HttpError(403, 'Only organization super admins can adopt standard roles.');
            const ids = [...new Set((Array.isArray(ctx.body.ids) ? ctx.body.ids : []).map(str))];
            if (!ids.length || ids.length > 100) throw new HttpError(400, 'Select between 1 and 100 standard roles.');
            const available = new Map(standardRoleTemplates(await catalogue(ctx.org)).map(t => [t.id, t]));
            const existing = await listDocs(`organizations/${ctx.orgId}/roles`);
            const possibleNew = ids.filter(id => available.has(id) && !existing.some(r => r.id === id));
            if (existing.length + possibleNew.length > 100) throw new HttpError(400, 'An organization can have at most 100 security roles.');
            const created: string[] = [];
            const skipped: Array<{ id: string; reason: string }> = [];
            for (const id of ids) {
                const template = available.get(id);
                if (!template) { skipped.push({ id, reason: 'Not available for an enabled module.' }); continue; }
                if (!canGrant(ctx, template.permissions)) { skipped.push({ id, reason: 'Missing grant authority.' }); continue; }
                if (sodConflicts(template.permissions).length) { skipped.push({ id, reason: 'Incompatible duties.' }); continue; }
                const now = nowIso();
                const didCreate = await writeDoc(`organizations/${ctx.orgId}/roles/${id}`, {
                    name: template.name, description: template.description, permissions: template.permissions,
                    system: false, standardTemplateId: id, standardTemplateVersion: 1,
                    createdAt: now, updatedAt: now, createdBy: ctx.uid,
                }, { exists: false });
                if (didCreate) created.push(id);
                else skipped.push({ id, reason: 'Already adopted; preserved existing customizations.' });
            }
            // Recommend and assign only exact-name, non-sensitive job-role matches.
            // Approval, posting, administration and existing mappings require deliberate assignment.
            const mappedPositions: string[] = [];
            if (created.length) {
                const sensitive = new Set(sensitiveKeys());
                const safeNew = [...available.values()].filter(t =>
                    created.includes(t.id) && t.permissions.every(p => !sensitive.has(p)) &&
                    !t.permissions.some(p => /\\.approve\\b|\\.admin\\b|\\.configure\\b/i.test(p)));
                const byName = new Map(safeNew.map(t => [t.name.toLowerCase().trim(), t.id]));
                for (const position of await listDocs(`organizations/${ctx.orgId}/positions`)) {
                    const current = Array.isArray(position.data.securityRoles) ? (position.data.securityRoles as unknown[]).map(str).filter(Boolean) : [];
                    if (current.length) continue;
                    const roleId = byName.get(str(position.data.title).toLowerCase().trim());
                    if (!roleId) continue;
                    await updateFields(`organizations/${ctx.orgId}/positions/${position.id}`, { securityRoles: [roleId] });
                    mappedPositions.push(position.id);
                }
                clearAccessCache(ctx.orgId);
                await record(ctx, 'org.roles.templates.apply', 'Standard security roles', `Adopted: ${created.join(', ')}. Auto-mapped safe exact-title positions: ${mappedPositions.join(', ') || 'none'}`);
            }
            return { created, skipped, mappedPositions };
        }),
    ],

    'POST /api/org/roles/list': [
        orgRoute('org.roles.list', 'ADM.roles', async (ctx) => {
            const [roles, users, groups, positions, docList] = await Promise.all([listDocs(`organizations/${ctx.orgId}/roles`), orgUsers(ctx.orgId), catalogue(ctx.org), listDocs(`organizations/${ctx.orgId}/positions`), listDocs(`organizations/${ctx.orgId}/role_docs`)]);
            const docById = new Map(docList.map((d) => [d.id, d.data]));
            const today = new Date().toISOString().slice(0, 10);
            const mapped = new Map<string, string[]>();
            for (const p of positions) for (const r of Array.isArray(p.data.securityRoles) ? (p.data.securityRoles as unknown[]).map(str) : []) mapped.set(r, [...(mapped.get(r) ?? []), `${p.id} ${str(p.data.title)}`]);
            const counts = new Map<string, number>();
            for (const u of users) {
                const r = str(u.data.role) === 'org_admin' ? 'org_super_admin' : str(u.data.role);
                counts.set(r, (counts.get(r) ?? 0) + 1);
            }
            // Retain the legacy default_security record for history only; it is no longer copied into roles.
            return {
                roles: roles.filter((r) => r.id !== 'default_security')
                    .map((r) => {
                        const permissions = Array.isArray(r.data.permissions) ? (r.data.permissions as unknown[]).map(str) : [];
                        return {
                            id: r.id,
                            name: str(r.data.name),
                            description: str(r.data.description),
                            permissions,
                            system: r.data.system === true,
                            users: counts.get(r.id) ?? 0,
                            jobRoles: mapped.get(r.id) ?? [],
                            updatedAt: str(r.data.updatedAt),
                            staleCount: reviewPermissions(permissions).stale.length,
                            conflicts: sodConflicts(permissions).map((c) => c.id),
                            docStatus: docStatus(docById.get(r.id), permissions, today),
                        };
                    })
                    .sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name)),
                catalogue: groups,
                sod: SOD_RULES,
                sensitive: sensitiveKeys(),
            };
        }),
    ],

    'POST /api/org/roles/save': [
        orgRoute('org.roles.save', 'ADM.roles', async (ctx) => {
            const raw = (isObj(ctx.body.role) ? ctx.body.role : {}) as Record<string, unknown>;
            const id = str(raw.id);
            const groups = await catalogue(ctx.org);
            const valid = new Set(groups.flatMap((g) => g.permissions.map((p) => p.key)));
            const permissions = Array.from(new Set((Array.isArray(raw.permissions) ? raw.permissions : []).map(str).filter((p) => valid.has(p))));
            if (!canGrant(ctx, permissions)) throw new HttpError(403, 'You cannot grant permissions you do not hold yourself.');
            const now = nowIso();
            const roles = await listDocs(`organizations/${ctx.orgId}/roles`);
            if (id) {
                const existing = roles.find((r) => r.id === id);
                if (!existing && id !== 'default_security') throw new HttpError(404, 'Role not found.');
                if (!existing && id === 'default_security') {
                    const note = requireSodAcknowledgement(raw, permissions);
                    await writeDoc(`organizations/${ctx.orgId}/roles/default_security`, { name: 'Default Security Role', description: 'Baseline permissions for newly created security roles.', permissions, system: true, createdAt: nowIso(), updatedAt: nowIso(), updatedBy: ctx.uid });
                    await record(ctx, 'org.role.baseline.create', 'Default Security Role', `${permissions.length} permissions.${note}`);
                    clearAccessCache(ctx.orgId);
                    return { id };
                }
                if (id === 'org_super_admin' || id === 'org_user') throw new HttpError(400, 'System identity roles cannot be modified.');
                if (id === ctx.role) throw new HttpError(403, 'You cannot edit the role you are assigned.');
                if (!existing) throw new HttpError(404, 'Role not found.');
                const system = existing.data.system === true;
                const name = system ? str(existing.data.name) : text(raw, 'name', 2, 60, 'Enter a role name (2 to 60 characters).');
                const description = system ? str(existing.data.description) : text(raw, 'description', 0, 300, 'Description can be up to 300 characters.');
                if (!system && roles.some((r) => r.id !== id && str(r.data.name).toLowerCase() === name.toLowerCase())) {
                    throw new HttpError(409, 'Another role already has this name.');
                }
                const note = requireSodAcknowledgement(raw, permissions);
                const before = new Set(Array.isArray(existing.data.permissions) ? (existing.data.permissions as unknown[]).map(str) : []);
                const added = permissions.filter((x) => !before.has(x));
                const removed = [...before].filter((x) => !permissions.includes(x));
                await writeDoc(`organizations/${ctx.orgId}/roles/${id}`, { ...existing.data, name, description, permissions, updatedAt: now, updatedBy: ctx.uid });
                await record(ctx, 'org.role.update', name, `${permissions.length} permissions. Added: ${added.join(', ') || 'none'}. Removed: ${removed.join(', ') || 'none'}.${note}`.slice(0, 1800));
                clearAccessCache(ctx.orgId);
                return { id };
            }
            const name = text(raw, 'name', 2, 60, 'Enter a role name (2 to 60 characters).');
            const description = text(raw, 'description', 0, 300, 'Description can be up to 300 characters.');
            if (roles.some((r) => str(r.data.name).toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'Another role already has this name.');
            if (roles.length >= 100) throw new HttpError(400, 'An organization can have up to 100 roles.');
            // Baseline self-service belongs to every authenticated user, NOT each role.
            const combined = permissions;
            const note = requireSodAcknowledgement(raw, combined);
            const newId = `role_${randomId(6)}`;
            await writeDoc(`organizations/${ctx.orgId}/roles/${newId}`, { name, description, permissions: combined, system: false, createdAt: now, updatedAt: now, createdBy: ctx.uid });
            await record(ctx, 'org.role.create', name, `${combined.length} permissions: ${combined.join(', ')}.${note}`.slice(0, 1800));
            return { id: newId };
        }),
    ],

    'POST /api/org/roles/delete': [
        orgRoute('org.roles.delete', 'ADM.roles', async (ctx) => {
            const id = str(ctx.body.id);
            const role = /^[a-z0-9_]{2,60}$/.test(id) ? await getDoc(`organizations/${ctx.orgId}/roles/${id}`) : null;
            if (!role) throw new HttpError(404, 'Role not found.');
            if (id === 'default_security' || role.data.system === true) throw new HttpError(400, 'System roles cannot be deleted.');
            const inUse = (await orgUsers(ctx.orgId)).filter((u) => str(u.data.role) === id).length;
            if (inUse) throw new HttpError(400, `This role is assigned to ${inUse} user(s). Reassign them first.`);
            const mappedTo = (await listDocs(`organizations/${ctx.orgId}/positions`)).filter((p) => Array.isArray(p.data.securityRoles) && (p.data.securityRoles as unknown[]).map(str).includes(id));
            if (mappedTo.length) throw new HttpError(400, `This role is mapped to job roles ${mappedTo.map((p) => p.id).join(', ')}. Remove the mapping first.`);
            await deleteDoc(`organizations/${ctx.orgId}/roles/${id}`);
            await record(ctx, 'org.role.delete', str(role.data.name));
            clearAccessCache(ctx.orgId);
            return { ok: true };
        }),
    ],

    'POST /api/org/users/reset-password': [
        orgRoute('org.users.reset_password', 'ADM.users', async (ctx) => {
            const uid = str(ctx.body.uid);
            if (uid === ctx.uid) throw new HttpError(400, 'Use My details to change your own password.');
            const target = await getOrgUser(ctx, uid);
            if (isSuperRole(str(target.data.role)) && ctx.role !== 'org_super_admin') throw new HttpError(403, 'Only a super admin can reset a super admin password.');
            const password = str(ctx.body.password);
            checkPassword(password);
            await updateAuthUser(uid, { password });
            await revokeTokens(uid);
            await updateFields(`users/${uid}`, { mustChangePassword: true, tokensValidAfter: nowIso(), passwordChangeRequiredAt: nowIso() });
            await record(ctx, 'org.user.reset_password', str(target.data.email));
            return { ok: true };
        }),
    ],

    'POST /api/org/audit': [
        orgRoute('org.audit', 'ADM.audit', async (ctx) => {
            return { events: await queryAudit(300, ctx.orgId) };
        }),
    ],
};
