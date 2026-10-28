import { HttpError, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { additionalRoleIds, hasPerm, orgRoute, type OrgContext } from './guards';
import { canGrant, record } from './org';
import { col as structureCol } from './structure';
import { docStatus, groupLabels, permissionsDigest } from './permissionPolicy';
import { standardRoleTemplates } from './standardRoleTemplates';
import { enabledModules } from './org';
import { buildCatalogue } from './permissionPolicy';

// Role documentation: the rules that go with a security role. Guidance for people, never part of access control.
//   organizations/{orgId}/role_docs/{roleId}                  current version
//   organizations/{orgId}/role_docs/{roleId}/versions/{n}     every version (kept for good)
// Plain text only, length limited, edited only by people who manage roles and could grant the role themselves.
// Every save is a new version with a reason and is audited. A fingerprint of the role's permissions is stored at
// review time so the documentation is flagged as out of date when the permissions change or the review date passes.

const root = (orgId: string) => `organizations/${orgId}/role_docs`;
const ROLE_ID = /^[a-z0-9_]{2,60}$/;

const FIELDS = {
    purpose: { label: 'Purpose', max: 400, min: 10 },
    audience: { label: 'Who should hold this role', max: 400, min: 0 },
    allows: { label: 'What the role allows', max: 1200, min: 10 },
    never: { label: 'Must never be combined with', max: 800, min: 0 },
    limits: { label: 'Approval and cost limits', max: 800, min: 0 },
    rules: { label: 'Rules for the people who hold it', max: 4000, min: 0 },
} as const;
type FieldKey = keyof typeof FIELDS;

/** Plain text: control characters removed, length checked. */
function cleanText(value: unknown, key: FieldKey): string {
    const f = FIELDS[key];
    const text = str(value)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/\r\n/g, '\n')
        .trim();
    if (text.length > f.max) throw new HttpError(400, `${f.label} can be up to ${f.max} characters.`);
    if (text.length < f.min) throw new HttpError(400, `${f.label}: write at least ${f.min} characters.`);
    return text;
}

const asList = (value: unknown): string[] => (Array.isArray(value) ? (value as unknown[]).map(str).filter(Boolean) : []);

async function loadRole(ctx: OrgContext, id: string): Promise<{ id: string; name: string; description: string; permissions: string[]; system: boolean }> {
    if (!ROLE_ID.test(id)) throw new HttpError(404, 'Role not found.');
    if (id === 'org_super_admin') return { id, name: 'Organization super admin', description: 'Full access to everything in the organization.', permissions: ['*'], system: true };
    const doc = await getDoc(`organizations/${ctx.orgId}/roles/${id}`);
    if (!doc) {
        if (id === 'default_security') return { id, name: 'Default Security Role', description: 'Baseline permissions copied into every newly created security role.', permissions: [], system: true };
        throw new HttpError(404, 'Role not found.');
    }
    return { id, name: str(doc.data.name) || id, description: str(doc.data.description), permissions: asList(doc.data.permissions), system: doc.data.system === true };
}

/** Security roles this person holds, directly or through the job roles they are assigned. */
function heldRoleIds(ctx: OrgContext): string[] {
    return Array.from(new Set([ctx.role, ...additionalRoleIds(ctx.me), ...ctx.grants.map((g) => g.roleId)])).filter(Boolean);
}

function docOut(doc: Doc | null, perms: string[], names: Map<string, string>) {
    if (!doc) return null;
    const d = doc.data;
    return {
        version: Number(d.version) || 1,
        purpose: str(d.purpose),
        audience: str(d.audience),
        allows: str(d.allows),
        never: str(d.never),
        limits: str(d.limits),
        rules: str(d.rules),
        nextReview: str(d.nextReview),
        updatedAt: str(d.updatedAt),
        updatedBy: names.get(str(d.updatedBy)) || '',
        status: docStatus(d, perms, new Date().toISOString().slice(0, 10)),
    };
}

async function userNames(orgId: string, uids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const uid of Array.from(new Set(uids)).filter((u) => /^[A-Za-z0-9]{6,128}$/.test(u)).slice(0, 25)) {
        const u = await getDoc(`users/${uid}`);
        if (u && str(u.data.orgId) === orgId) out.set(uid, [str(u.data.firstName), str(u.data.lastName)].filter(Boolean).join(' ') || str(u.data.email));
    }
    return out;
}

export async function fillMissingStandardRoleDocs(orgId: string, actorId: string): Promise<number> {
    const org = await getDoc(`organizations/${orgId}`);
    if (!org) throw new HttpError(404, 'Organization not found.');
    const modules = await enabledModules(org);
    const templates = new Map(standardRoleTemplates(buildCatalogue(modules)).map(t => [t.id,t]));
    const roles = await listDocs(`organizations/${orgId}/roles`);
    let created = 0;
    for (const role of roles) {
        const template = templates.get(role.id);
        if (!template) continue;
        const permissions = asList(role.data.permissions);
        const out = `${root(orgId)}/${role.id}`;
        if (await getDoc(out)) continue;
        const now = nowIso();
        const data = {
            version: 1,
            purpose: template.description.slice(0,400).padEnd(10,'.'),
            audience: 'Employees and managers assigned this role by organizational authority.',
            allows: `May perform these configured transaction permissions: ${permissions.join(', ')}`.slice(0,1200),
            never: 'Never exceed assigned organizational scope or combine conflicting duties.',
            limits: 'Approval and financial limits remain governed by organizational authority and workflow rules.',
            rules: `Transactions must be performed only through authorized MEMS handlers. Role template: ${template.name}. All activity remains subject to audit, segregation of duties and relevant workflow approvals.`,
            nextReview: '',
            reviewedDigest: permissionsDigest(permissions),
            createdAt:now,updatedAt:now,createdBy:actorId,updatedBy:actorId,
        };
        if (await writeDoc(out,data,{exists:false})) {
            await writeDoc(`${out}/versions/1`,{...data,reason:'Automatically generated standard template rules'}, {exists:false});
            created++;
        }
    }
    return created;
}

export const roleDocRoutes = {
    'POST /api/org/roles/docs/fill-standard': [
        orgRoute('org.roles.docs.fill-standard','ADM.roles',async (ctx) => {
            if (ctx.role !== 'org_super_admin') throw new HttpError(403,'Only organization super admins may initialize standard role documentation.');
            const count = await fillMissingStandardRoleDocs(ctx.orgId,ctx.uid);
            if (count) await record(ctx,'org.roles.docs.fill-standard','Standard role documents',`Created ${count} missing standard rule documents`);
            return {created:count};
        }),
    ],

    'POST /api/org/roles/docs/get': [
        orgRoute('org.roles.docs.get', null, async (ctx) => {
            const role = await loadRole(ctx, str(ctx.body.id));
            const canEdit = ctx.role === 'org_super_admin' || (hasPerm(ctx.permissions, 'ADM.roles') && canGrant(ctx, role.permissions));
            const manages = ctx.role === 'org_super_admin' || hasPerm(ctx.permissions, 'ADM.roles');
            if (!manages && !heldRoleIds(ctx).includes(role.id)) throw new HttpError(403, 'You can read the documentation of roles you hold.');
            const doc = await getDoc(`${root(ctx.orgId)}/${role.id}`);
            const versions = manages ? await listDocs(`${root(ctx.orgId)}/${role.id}/versions`) : [];
            const names = await userNames(ctx.orgId, [str(doc?.data.updatedBy), ...versions.map((v) => str(v.data.updatedBy))]);
            return {
                role: { id: role.id, name: role.name, description: role.description, permissionCount: role.permissions.includes('*') ? -1 : role.permissions.length, system: role.system },
                permissions: groupLabels(role.permissions),
                doc: docOut(doc, role.permissions, names),
                canEdit,
                history: versions
                    .map((v) => ({ version: Number(v.data.version) || 0, at: str(v.data.updatedAt), by: names.get(str(v.data.updatedBy)) || '', reason: str(v.data.reason) }))
                    .sort((a, b) => b.version - a.version)
                    .slice(0, 30),
            };
        }),
    ],

    'POST /api/org/roles/docs/save': [
        orgRoute('org.roles.docs.save', 'ADM.roles', async (ctx) => {
            const body = ctx.body;
            const role = await loadRole(ctx, str(body.id));
            if (ctx.role !== 'org_super_admin' && !canGrant(ctx, role.permissions)) throw new HttpError(403, 'You can only document roles whose rights you hold yourself.');
            const reason = str(body.reason).trim();
            if (reason.length < 10 || reason.length > 300) throw new HttpError(400, 'Give the reason for this change (10 to 300 characters).');
            const fields = {} as Record<FieldKey, string>;
            for (const key of Object.keys(FIELDS) as FieldKey[]) fields[key] = cleanText(body[key], key);
            const nextReview = str(body.nextReview);
            if (nextReview && (!/^\d{4}-\d{2}-\d{2}$/.test(nextReview) || Number.isNaN(Date.parse(`${nextReview}T00:00:00Z`)))) throw new HttpError(400, 'Enter a valid review date.');
            if (nextReview && nextReview < new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'The next review date cannot be in the past.');
            const path = `${root(ctx.orgId)}/${role.id}`;
            const existing = await getDoc(path);
            const current = Number(existing?.data.version) || 0;
            if (Number(body.expectedVersion) !== current) throw new HttpError(409, 'Someone else changed this documentation. Reload and apply your changes again.');
            const version = current + 1;
            const now = nowIso();
            const data = { ...fields, nextReview, version, reviewedDigest: permissionsDigest(role.permissions), updatedAt: now, updatedBy: ctx.uid };
            await writeDoc(`${path}/versions/${version}`, { ...data, reason }, { exists: false });
            await writeDoc(path, { ...data, createdAt: existing ? str(existing.data.createdAt) : now, createdBy: existing ? str(existing.data.createdBy) : ctx.uid });
            await record(ctx, 'org.role.docs.save', role.name, `Version ${version}. Reason: ${reason}`);
            return { ok: true, version };
        }),
    ],

    // Everything the signed-in person holds, in plain words, with the documentation of each role.
    'POST /api/org/my-access': [
        orgRoute('org.my_access', null, async (ctx) => {
            const [positions, nodes] = await Promise.all([listDocs(`organizations/${ctx.orgId}/positions`), listDocs(structureCol(ctx.orgId))]);
            const titles = new Map(positions.map((p) => [p.id, str(p.data.title)]));
            const places = new Map(nodes.map((n) => [n.id, [str(n.data.code), str(n.data.name)].filter(Boolean).join(' ')]));
            const assignments = (Array.isArray(ctx.me.data.assignments) ? (ctx.me.data.assignments as unknown[]) : []).filter(isObj);
            const roleIds = heldRoleIds(ctx).filter((r) => r !== 'org_user' || ctx.role === 'org_user');
            const roles: Array<Record<string, unknown>> = [];
            for (const id of roleIds) {
                const doc = await getDoc(`${root(ctx.orgId)}/${id}`).catch(() => null);
                const role = await loadRole(ctx, id).catch(() => null);
                if (!role) continue;
                const direct = id === ctx.role;
                const grants = ctx.grants.filter((g) => g.roleId === id);
                const effective = direct ? ctx.directPermissions : Array.from(new Set(grants.flatMap((g) => g.permissions)));
                const names = await userNames(ctx.orgId, [str(doc?.data.updatedBy)]);
                roles.push({
                    id,
                    name: role.name,
                    description: role.description,
                    how: [direct ? 'Given to you directly' : '', ...grants.map((g) => `Through job role ${g.positionCode} ${titles.get(g.positionCode) ?? ''}`.trim())].filter(Boolean),
                    appliesAt: direct ? 'Everywhere inside your own scope' : Array.from(new Set(grants.map((g) => places.get(g.nodeId) || g.nodeId))).join(', ') + ' and below',
                    permissions: groupLabels(effective),
                    doc: docOut(doc, role.permissions, names),
                });
            }
            return {
                roleName: ctx.roleName,
                expiresAt: str(ctx.me.data.roleExpiresAt),
                jobRoles: assignments.map((a) => ({ code: str(a.positionCode), title: titles.get(str(a.positionCode)) ?? '', place: places.get(str(a.nodeId)) ?? '', type: str(a.type) || 'primary', startsOn: str(a.startsOn), endsOn: str(a.endsOn) })),
                roles,
            };
        }),
    ],
};
