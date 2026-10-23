import { notifyMaterialChanges, withChangeTracking } from './changeTracker';
import { json, error } from './platform/sdk';
import { assertHealthAccess } from './healthPolicy';
import {
    HttpError,
    STAFF_DOMAIN,
    deleteAuthUser,
    deleteDoc,
    emailDomain,
    getDoc,
    isAuthEmailVerified,
    emailVerificationRequired,
    isBuiltinPublicEmail,
    listDocs,
    nextSequence,
    nowIso,
    requestMeta,
    str,
    updateFields,
    verifyIdToken,
    writeDoc,
    type Doc,
    type RequestMeta,
    type TokenClaims,
} from './core';
import { audit, type Actor } from './audit';
import type { GovernanceHandlerMetadata } from './transactionRuntime';
import { moduleDisableReason } from './transactionModuleGate';
import { enforceOrgTransactionGovernance } from './unifiedGovernanceRuntime';
import {docAreaForTransaction,enabledDocAreas} from './docSubmodules';

export const STAFF_ROLES = ['super_admin', 'mems_admin', 'mems_support'];

type RawCtx = { body: unknown; event?: unknown };

export function toErrorResponse(err: unknown) {
    if (err instanceof HttpError) return error(err.message, err.status);
    console.error('Unexpected server error', err instanceof Error ? err.message : 'unknown');
    return error('Something went wrong. Please try again.', 500);
}

export function bodyOf(ctx: RawCtx): Record<string, unknown> {
    return ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Record<string, unknown>) : {};
}

/** Unauthenticated route. Handlers rate-limit and audit their own important events. */
export function publicRoute(fn: (body: Record<string, unknown>, meta: RequestMeta) => Promise<unknown>) {
    return async (ctx: RawCtx) => {
        try {
            return json(await fn(bodyOf(ctx), requestMeta(ctx.event)));
        } catch (err) {
            return toErrorResponse(err);
        }
    };
}

export interface SecureContext {
    uid: string;
    claims: TokenClaims;
    body: Record<string, unknown>;
    actor: Actor;
    meta: RequestMeta;
}

/** Authenticated route. Every call is audited with outcome, duration, IP and device. */
export function secure(name: string, fn: (ctx: SecureContext) => Promise<unknown>) {
    return async (ctx: RawCtx) => {
        const started = Date.now();
        const meta = requestMeta(ctx.event);
        let actor: Actor | null = null;
        try {
            const body = bodyOf(ctx);
            const claims = await verifyIdToken(body.idToken);
            actor = { uid: claims.sub, email: claims.email };
            if (claims.signInProvider !== 'password' || !claims.email || isBuiltinPublicEmail(claims.email)) {
                throw new HttpError(403, 'This account is not allowed to use MEMS.');
            }
            // A temporary password is not authorization to use business APIs. The existing
            // password-change screen remains unchanged; only session and its confirmation
            // endpoint are available until the change is independently verified.
            if (name !== 'session' && name !== 'profile.password_changed') {
                const current = await getDoc('users/' + claims.sub);
                if (current?.data.mustChangePassword === true) throw new HttpError(403, 'Change your temporary password before continuing.');
                if (current && name !== 'profile.health.status' && name !== 'profile.health.pulse') {
                    // Health breaks and weekly rest days deny ALL protected business
                    // operations, even when a Firebase credential remains valid.
                    assertHealthAccess(current);
                }
            }
            const result = await fn({ uid: claims.sub, claims, body, actor, meta });
            if (name !== 'profile.health.pulse') {
                await audit([{ category: 'api', action: name, actor, meta, durationMs: Date.now() - started }]);
            }
            return json(result);
        } catch (err) {
            const status = err instanceof HttpError ? err.status : 500;
            await audit([
                {
                    category: 'api',
                    action: name,
                    outcome: status === 401 || status === 403 ? 'denied' : 'failure',
                    actor,
                    meta,
                    details: err instanceof Error ? err.message : 'Error',
                    durationMs: Date.now() - started,
                },
            ]);
            return toErrorResponse(err);
        }
    };
}

/** True when the token was issued before the user's sessions were revoked. */
export function isTokenStale(user: Doc, claims: TokenClaims): boolean {
    const validAfter = Date.parse(str(user.data.tokensValidAfter));
    return !Number.isNaN(validAfter) && claims.iat * 1000 + 999 < validAfter;
}

export interface StaffContext extends SecureContext {
    role: string;
    me: Doc;
}

export function staff(name: string, level: 'read' | 'write' | 'super', fn: (ctx: StaffContext) => Promise<unknown>) {
    const guarded = secure(name, async (ctx) => {
        const me = await getDoc(`users/${ctx.uid}`);
        const role = str(me?.data.role);
        if (!me || !STAFF_ROLES.includes(role) || str(me.data.status) === 'disabled' || emailDomain(ctx.claims.email) !== STAFF_DOMAIN) {
            throw new HttpError(403, 'Only MEMS staff can do this.');
        }
        if (isTokenStale(me, ctx.claims)) throw new HttpError(401, 'Your session has expired. Please log in again.');
        ctx.actor.role = role;
        if (level === 'write' && role === 'mems_support') throw new HttpError(403, 'Your role has read-only access.');
        if (level === 'super' && role !== 'super_admin') throw new HttpError(403, 'Only a super admin can do this.');
        return fn({ ...ctx, role, me });
    });
    return Object.assign(guarded,{governanceMetadata:Object.freeze({name,permission:level,kind:'staff' as const} satisfies GovernanceHandlerMetadata)});
}

// ---------------------------------------------------------------------------
// Tenant (organization) helpers
// ---------------------------------------------------------------------------

export const normalizeOrgRole = (role: string) => (role === 'org_admin' ? 'org_super_admin' : role);

export function hasPerm(permissions: string[], permission: string): boolean {
    if (permissions.includes('*') || permissions.includes(permission)) return true;
    const parts = permission.split('.');
    for (let i = parts.length - 1; i > 0; i--) if (permissions.includes(`${parts.slice(0, i).join('.')}.*`)) return true;
    return false;
}

// Older security roles used module-level maintenance actions. They are expanded to the activity
// permissions they used to cover, so existing roles keep working until an administrator refines them.
const LEGACY_EXPANSION: Record<string, string[]> = {
    'MNT.create': ['MNT.WR.create', 'MNT.WO.create'],
    'MNT.edit': ['MNT.WR.edit', 'MNT.WO.plan', 'MNT.WO.schedule', 'MNT.WO.execute'],
    'MNT.delete': ['MNT.WR.cancel', 'MNT.WO.cancel'],
    'MNT.approve': ['MNT.WR.review', 'MNT.WR.return', 'MNT.WR.decline', 'MNT.WR.convert', 'MNT.WO.safety', 'MNT.WO.release', 'MNT.WO.verify', 'MNT.WO.close'],
    'MNT.admin': ['MNT.WO.reopen'],
    // MRP was renamed Replenishment (MRP is now one of its strategies).
    'INV.mrp.view': ['INV.replenishment.view'],
    'INV.mrp.run': ['INV.replenishment.run'],
    'INV.mrp.verify': ['INV.replenishment.verify'],
};

export function expandPermissions(perms: string[]): string[] {
    const out = new Set(perms);
    for (const p of perms) for (const x of LEGACY_EXPANSION[p] ?? []) out.add(x);
    return [...out];
}

// ---------------------------------------------------------------------------
// Access engine: job roles (positions) are mapped to security roles; holding a job role at a
// place grants the mapped permissions at that place and below. Cached briefly per organization.
// ---------------------------------------------------------------------------

export interface Grant {
    source: 'job';
    positionCode: string;
    nodeId: string;
    roleId: string;
    roleName: string;
    permissions: string[];
}

interface AccessCache {
    at: number;
    positions: Map<string, { title: string; securityRoles: string[] }>;
    roles: Map<string, { name: string; permissions: string[] }>;
}
const accessCache = new Map<string, AccessCache>();
const ACCESS_TTL_MS = 30_000;

export function clearAccessCache(orgId: string) {
    accessCache.delete(orgId);
}

async function accessData(orgId: string): Promise<AccessCache> {
    const hit = accessCache.get(orgId);
    if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit;
    const [posDocs, roleDocs] = await Promise.all([listDocs(`organizations/${orgId}/positions`), listDocs(`organizations/${orgId}/roles`)]);
    const positions = new Map(
        posDocs.map((d) => [d.id, { title: str(d.data.title), securityRoles: Array.isArray(d.data.securityRoles) ? (d.data.securityRoles as unknown[]).map(str).filter(Boolean) : [] }])
    );
    const roles = new Map(
        roleDocs.map((d) => [d.id, { name: str(d.data.name) || d.id, permissions: expandPermissions(Array.isArray(d.data.permissions) ? (d.data.permissions as unknown[]).map(str).filter(Boolean) : []) }])
    );
    const value = { at: Date.now(), positions, roles };
    accessCache.set(orgId, value);
    return value;
}

/** Permissions a user receives through their job roles, one grant per (assignment, security role). */
export async function jobGrants(orgId: string, user: Doc): Promise<Grant[]> {
    const data = await accessData(orgId);
    const assignments = (Array.isArray(user.data.assignments) ? (user.data.assignments as unknown[]) : []).slice(0, 2).filter(
        (a): a is Record<string, unknown> => !!a && typeof a === 'object' && !Array.isArray(a)
    );
    const grants: Grant[] = [];
    for (const a of assignments) {
        const assignmentType = str(a.type);
        if (assignmentType && assignmentType !== 'primary' && !['acting', 'extended_function', 'secondment'].includes(assignmentType)) continue;
        if (assignmentType && assignmentType !== 'primary' && (!/^\d{4}-\d{2}-\d{2}$/.test(str(a.endsOn)) || str(a.endsOn) < new Date().toISOString().slice(0, 10))) continue;
        if (assignmentType && assignmentType !== 'primary' && str(a.startsOn) > new Date().toISOString().slice(0, 10)) continue;
        const positionCode = str(a.positionCode);
        const nodeId = str(a.nodeId);
        const position = data.positions.get(positionCode);
        if (!position || !nodeId) continue;
        for (const roleId of position.securityRoles) {
            if (roleId === 'org_super_admin') continue;
            const role = data.roles.get(roleId);
            if (!role) continue;
            // Administration rights are never passed on through job roles.
            const permissions = role.permissions.filter((p) => p !== '*' && !p.startsWith('ADM.'));
            if (permissions.length) grants.push({ source: 'job', positionCode, nodeId, roleId, roleName: role.name, permissions });
        }
    }
    return grants;
}

export function roleExpired(user: Doc): boolean {
    const raw = str(user.data.roleExpiresAt);
    if (!raw) return false;
    const t = Date.parse(raw.length === 10 ? `${raw}T23:59:59Z` : raw);
    return !Number.isNaN(t) && t < Date.now();
}

/** Everything a member may do: direct security role (unless expired) plus job-role grants. */
export async function effectiveAccess(orgId: string, role: string, user: Doc, adoptedModules?: unknown) {
    const loaded = await loadRole(orgId, role);
    if (role === 'org_super_admin') return { roleName: loaded.name, directPermissions: loaded.permissions, grants: [] as Grant[], permissions: loaded.permissions, expired: false };
    const expired = roleExpired(user);
    const directPermissions = expired ? [] : loaded.permissions.filter((p) => p !== '*');
    const grants = await jobGrants(orgId, user);
    // HR workspace access is a baseline employee self-service entitlement when HRM is adopted.
    // It grants no site-wide directory, HR administration, or payroll permissions.
    const modules = adoptedModules && typeof adoptedModules === 'object' && !Array.isArray(adoptedModules)
        ? adoptedModules as Record<string, unknown> : {};
    const hrSelfService = modules.HRM === true || modules.HRM === 'enabled';
    const permissions = Array.from(new Set([
        ...directPermissions, ...grants.flatMap((g) => g.permissions),
        ...(hrSelfService ? ['HRM.shell.view'] : []),
    ]));
    return { roleName: expired ? `${loaded.name} (expired)` : loaded.name, directPermissions, grants, permissions, expired };
}

export async function loadRole(orgId: string, role: string): Promise<{ name: string; permissions: string[] }> {
    if (role === 'org_super_admin') return { name: 'Organization super admin', permissions: ['*'] };
    if (!/^[a-z0-9_]{2,60}$/.test(role)) return { name: role, permissions: [] };
    const doc = await getDoc(`organizations/${orgId}/roles/${role}`);
    const perms = Array.isArray(doc?.data.permissions) ? (doc?.data.permissions as unknown[]).map(str).filter(Boolean) : [];
    return { name: str(doc?.data.name) || role, permissions: expandPermissions(perms) };
}

/** Organizations are identified by the creator's email extension. Older tenants get it backfilled. */
export async function ensureOrgDomain(org: Doc): Promise<string> {
    const existing = str(org.data.domain);
    if (existing) return existing;
    const createdBy = str(org.data.createdBy);
    if (!createdBy) return '';
    const creator = await getDoc(`users/${createdBy}`);
    const domain = emailDomain(str(creator?.data.email));
    if (!domain) return '';
    await updateFields(`organizations/${org.id}`, { domain });
    await writeDoc(`org_domains/${domain}`, { orgId: org.id, claimedAt: nowIso(), status: 'active' }, { exists: false });
    org.data.domain = domain;
    return domain;
}

/** Allocates the next unique organization code, e.g. ORG_0000001, from the database sequence. */
export async function allocateOrgCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const n = await nextSequence('orgSeq');
        if (n > 9_999_999) throw new HttpError(500, 'The organization code sequence is exhausted.');
        const code = `ORG_${String(n).padStart(7, '0')}`;
        if (await writeDoc(`org_codes/${code}`, { orgId: '', assignedAt: nowIso() }, { exists: false })) return code;
    }
    throw new HttpError(500, 'Could not allocate an organization code.');
}

export async function ensureOrgCode(org: Doc): Promise<string> {
    const existing = str(org.data.code);
    if (existing) return existing;
    const code = await allocateOrgCode();
    await updateFields(`organizations/${org.id}`, { code });
    await writeDoc(`org_codes/${code}`, { orgId: org.id, assignedAt: nowIso() });
    org.data.code = code;
    return code;
}

/**
 * Records when the creator verifies their email. Activation itself always requires
 * approval by a MEMS super admin. Returns the normalised organization status.
 */
export async function activateIfVerified(org: Doc, claims: TokenClaims, actor: Actor, meta: RequestMeta): Promise<string> {
    const raw = str(org.data.status);
    const status = raw === 'pending_verification' ? 'pending_approval' : raw;
    if (status === 'pending_approval' && claims.emailVerified && str(org.data.createdBy) === claims.sub && org.data.creatorEmailVerified !== true) {
        await updateFields(`organizations/${org.id}`, { creatorEmailVerified: true, emailVerifiedAt: nowIso() });
        org.data.creatorEmailVerified = true;
        await audit([
            {
                category: 'registration',
                action: 'tenant.email_verified',
                actor,
                meta,
                orgId: org.id,
                target: { type: 'organization', id: org.id, label: str(org.data.name) },
                details: 'Creator email verified; awaiting MEMS approval',
            },
        ]);
    }
    return status;
}

/** Deletes every uploaded registration document (and its chunks) for an organization. */
export async function purgeRegistrationFiles(orgId: string): Promise<void> {
    const base = `organizations/${orgId}/registration_files`;
    for (const file of await listDocs(base)) {
        for (const chunk of await listDocs(`${base}/${file.id}/chunks`)) await deleteDoc(`${base}/${file.id}/chunks/${chunk.id}`);
        await deleteDoc(`${base}/${file.id}`);
    }
}

const STALE_CLAIM_MS = 48 * 3600 * 1000;

/** Frees an email extension held by a registration whose creator never verified their email within 48 hours. */
export async function releaseStaleDomainClaim(domain: string, meta: RequestMeta): Promise<void> {
    const claim = await getDoc(`org_domains/${domain}`);
    if (!claim) return;
    const age = Date.now() - Date.parse(str(claim.data.claimedAt));
    const orgId = str(claim.data.orgId);
    const applicationId = str(claim.data.applicationId);
    if (!orgId && applicationId) {
        const app = await getDoc(`applications/${applicationId}`);
        if (!app || str(app.data.status) === 'rejected') {
            await deleteDoc(`org_domains/${domain}`);
            return;
        }
        if (str(app.data.status) !== 'draft' || age < STALE_CLAIM_MS) return;
        if (!(await emailVerificationRequired())) return;
        if (await isAuthEmailVerified(applicationId)) return;
        await deleteAuthUser(applicationId);
        await deleteDoc(`users/${applicationId}`);
        await deleteDoc(`applications/${applicationId}`);
        await deleteDoc(`org_domains/${domain}`);
        await audit([
            {
                category: 'registration',
                action: 'application.released',
                meta,
                target: { type: 'application', id: applicationId, label: str(app.data.email) },
                details: `@${domain} released: email not verified within 48 hours`,
            },
        ]);
        return;
    }
    if (!orgId) {
        if (age > 3600 * 1000) await deleteDoc(`org_domains/${domain}`);
        return;
    }
    const org = await getDoc(`organizations/${orgId}`);
    if (!org) {
        await deleteDoc(`org_domains/${domain}`);
        return;
    }
    const orgStatus = str(org.data.status);
    if (orgStatus === 'rejected') {
        await deleteDoc(`org_domains/${domain}`);
        return;
    }
    if ((orgStatus !== 'pending_verification' && orgStatus !== 'pending_approval') || age < STALE_CLAIM_MS) return;
    const creator = str(org.data.createdBy);
    if (org.data.creatorEmailVerified === true || (creator && (await isAuthEmailVerified(creator)))) return;
    await purgeRegistrationFiles(orgId);
    if (creator) {
        await deleteAuthUser(creator);
        await deleteDoc(`users/${creator}`);
    }
    await deleteDoc(`organizations/${orgId}/roles/org_super_admin`);
    await deleteDoc(`organizations/${orgId}/roles/org_user`);
    await deleteDoc(`organizations/${orgId}`);
    await deleteDoc(`org_domains/${domain}`);
    await audit([
        {
            category: 'registration',
            action: 'tenant.claim_released',
            meta,
            target: { type: 'organization', id: orgId, label: str(org.data.name) },
            details: `@${domain} released: creator email not verified within 48 hours`,
        },
    ]);
}

export function landingFor(role: string, permissions: string[]): string {
    return role === 'org_super_admin' || permissions.some((p) => p === '*' || p.startsWith('ADM.')) ? 'organization_admin' : 'organization_home';
}

export interface OrgContext extends SecureContext {
    me: Doc;
    org: Doc;
    orgId: string;
    role: string;
    roleName: string;
    /** Union of direct and job-role permissions: use for menus and org-wide checks only. */
    permissions: string[];
    /** Permissions of the directly assigned security role (empty when it has expired). */
    directPermissions: string[];
    /** Location-bound permissions from job roles. Records are checked with access.canAt(). */
    grants: Grant[];
    domain: string;
}

/**
 * Tenant route. The organization is ALWAYS taken from the signed-in user's own
 * record, never from the request, so a tenant can never reach another tenant's data.
 */
export function orgRoute(name: string, permission: string | null, fn: (ctx: OrgContext) => Promise<unknown>) {
    const guarded = secure(name, async (ctx) => {
        const me = await getDoc(`users/${ctx.uid}`);
        const orgId = str(me?.data.orgId);
        if (!me || !orgId) throw new HttpError(403, 'You are not a member of an organization.');
        if (str(me.data.status) === 'disabled') throw new HttpError(403, 'Your account has been disabled.');
        if (isTokenStale(me, ctx.claims)) throw new HttpError(401, 'Your session has expired. Please log in again.');
        ctx.actor.orgId = orgId;
        const org = await getDoc(`organizations/${orgId}`);
        if (!org) throw new HttpError(403, 'Your organization could not be found.');
        const status = await activateIfVerified(org, ctx.claims, ctx.actor, ctx.meta);
        if (status === 'suspended') throw new HttpError(403, 'Your organization has been suspended.');
        if (status === 'pending_approval') throw new HttpError(403, 'Your organization is pending approval by MEMS.');
        if (status === 'rejected') throw new HttpError(403, 'Your organization registration was not approved.');
        // Tenant bootstrap rule: site structure and job roles must exist before protected
        // functional configuration. Reads and personal routes remain available.
        if (permission && permission !== 'ADM.structure' &&
            !name.startsWith('org.structure.') && !name.startsWith('org.positions.') &&
            !name.startsWith('org.setup.') && !name.startsWith('org.roles.')) {
            const [nodes, positions] = await Promise.all([
                listDocs(`organizations/${orgId}/structure`),
                listDocs(`organizations/${orgId}/positions`),
            ]);
            const has = (level: string) => nodes.some((d) => str(d.data.level) === level && str(d.data.status) !== 'inactive');
            if (!has('legal_entity') || !has('site') || positions.length === 0) {
                throw new HttpError(428, 'Complete the legal entity, site and at least one job role under Organization design before continuing with other configuration.');
            }
        }
        const moduleDisabled = moduleDisableReason(name,permission,org.data.modules);
        if(moduleDisabled && permission)throw new HttpError(403,moduleDisabled);
        const domain = await ensureOrgDomain(org);
        if (domain && emailDomain(ctx.claims.email) !== domain) throw new HttpError(403, 'Your account does not belong to this organization.');
        if (name.startsWith('chat.') && name !== 'chat.policy.status' && name !== 'chat.policy.accept') {
            const acknowledgement = await getDoc('users/' + ctx.uid + '/chat_policy/acknowledgement');
            if (str(acknowledgement?.data.version) !== 'CHAT_WORKPLACE_2026_10') {
                throw new HttpError(428, 'Please acknowledge your organization Chat workplace notice to continue.');
            }
        }
        const role = normalizeOrgRole(str(me.data.role));
        ctx.actor.role = role;
        const access = await effectiveAccess(orgId, role, me, org.data.modules);
        // Administration rights (ADM.*) only ever come from the directly assigned security role.
        const gate = permission && permission.startsWith('ADM.') ? access.directPermissions : access.permissions;
        const granted = role === 'org_super_admin' || (permission !== null && hasPerm(gate, permission));
        if (permission && !granted) throw new HttpError(403, 'You do not have permission to do this.');
        // Tenant switches supplement (never override) the existing security role checks.
        const docArea=docAreaForTransaction(name);
        if(docArea){
            const settings=await getDoc(`organizations/${orgId}/drkms_config/default`);
            if(!enabledDocAreas(settings?.data.enabledSubmodules).includes(docArea))
                throw new HttpError(403,'This DOC submodule is disabled for your organization.');
        }
        const finishApproval = await enforceOrgTransactionGovernance({ orgId, name, permission, effectivePermissionGranted: granted, org, uid: ctx.uid, body:ctx.body });
        let result: unknown;
        let tracked: Awaited<ReturnType<typeof withChangeTracking>> | null = null;
        try {
            // Material changes made by this request are collected and handed to MRP once it has succeeded.
            tracked = await withChangeTracking(() => fn({ ...ctx, me, org, orgId, role, roleName: access.roleName, permissions: access.permissions, directPermissions: access.directPermissions, grants: access.grants, domain }));
            result = tracked.result;
        } catch (err) {
            try { await finishApproval?.(false); }
            catch (finalError) { console.error('Could not reconcile failed governance execution', finalError instanceof Error ? finalError.message : 'unknown'); }
            throw err;
        }
        // Never mark an already-successful business transaction as failed just because
        // the separate workflow completion journal could not be updated.
        try { await finishApproval?.(true); }
        catch (finalError) {
            console.error('Approval execution completed but requires workflow reconciliation', finalError instanceof Error ? finalError.message : 'unknown');
            await audit([{category:'governance',action:'governance.approval.reconciliation_required',actor:ctx.actor,meta:ctx.meta,
                target:{type:'transaction',label:name},outcome:'blocked',
                details:'Business handler succeeded but approval completion write failed'}]);
        }
        if (tracked && (tracked.changes.length || tracked.unresolved.length)) {
            await notifyMaterialChanges({ orgId, uid: ctx.uid, actorName: str(me.data.email), route: name, changes: tracked.changes.filter((c) => c.orgId === orgId), unresolved: tracked.unresolved });
        }
        return result;
    });
    return Object.assign(guarded, { governanceMetadata: Object.freeze({ name, permission, kind: 'organization' as const } satisfies GovernanceHandlerMetadata) });
}
