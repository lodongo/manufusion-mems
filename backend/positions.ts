import { storage } from './platform/sdk';
import {
    DOCUMENT_NAME_ROOT,
    FIRESTORE_BASE,
    HttpError,
    deleteDoc,
    fail,
    getDoc,
    googleRequest,
    isObj,
    listDocs,
    nowIso,
    randomId,
    rateLimit,
    runQuery,
    str,
    text,
    updateFields,
    writeDoc,
    type Doc,
    type Plain,
} from './core';
import { clearAccessCache, hasPerm, orgRoute, type OrgContext } from './guards';
import { detectImage } from './branding';
import { ID_RE, childrenOf, col, designOf, getNode, managerContext, nodeOut, record } from './structure';
import { matchingRoleNodes, employmentCoverage, type RoleStaffingRow, type StaffingUnit } from './positionStaffing';

// Organization roles (job positions such as CEO or Manufacturing Manager).
// These are NOT system access roles: they describe the org chart, not what a user can do in MEMS.
// Stored at organizations/{orgId}/positions/{ROL_000001}, numbered from a per-organization counter.

const posCol = (orgId: string) => `organizations/${orgId}/positions`;
const SCOPE_LEVELS = ['group', 'legal_entity', 'site', 'department', 'cost_center'];

function readAssignments(raw: Plain | undefined): Array<{ positionCode: string; nodeId: string; type: string; startsOn: string; endsOn: string }> {
    return (Array.isArray(raw) ? raw : []).slice(0, 2).filter(isObj).map((a, i) => ({ positionCode: str(a.positionCode), nodeId: str(a.nodeId), type: i === 0 ? 'primary' : str(a.type), startsOn: str(a.startsOn), endsOn: str(a.endsOn) }));
}

/**
 * Units a user may work in: everything under the units where their organization roles apply,
 * plus any special view access. Returns 'all' for whole-organization access. Used by modules
 * to keep users inside their assigned scope.
 */
export async function allowedNodeIds(orgId: string, user: Doc, includeViewExtras = false): Promise<Set<string> | 'all'> {
    const roots = readAssignments(user.data.assignments).filter((a) => a.type === 'primary' || (['acting', 'extended_function', 'secondment'].includes(a.type) && a.endsOn >= new Date().toISOString().slice(0, 10) && a.startsOn <= new Date().toISOString().slice(0, 10))).map((a) => a.nodeId);
    if (includeViewExtras) {
        const extras = Array.isArray(user.data.extraScopes) ? (user.data.extraScopes as Plain[]).map(str) : [];
        if (extras.includes('root')) return 'all';
        roots.push(...extras);
    }
    const nodes = (await listDocs(col(orgId))).map(nodeOut);
    const children = new Map<string, string[]>();
    for (const n of nodes) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
    const allowed = new Set<string>();
    const stack = [...roots];
    while (stack.length) {
        const id = stack.pop() as string;
        if (allowed.has(id)) continue;
        allowed.add(id);
        stack.push(...(children.get(id) ?? []));
    }
    return allowed;
}

function positionOut(doc: Doc) {
    const d = doc.data;
    return {
        code: doc.id,
        title: str(d.title),
        description: str(d.description),
        parentCode: str(d.parentCode),
        operatingLevel: str(d.operatingLevel),
        defaultNodeId: str(d.defaultNodeId),
        securityRoles: Array.isArray(d.securityRoles) ? (d.securityRoles as Plain[]).map(str).filter(Boolean) : [],
        coreSkills: Array.isArray(d.coreSkills) ? (d.coreSkills as Plain[]).map(str).filter(Boolean) : [],
        staffingPlan: (Array.isArray(d.staffingPlan) ? d.staffingPlan : []).filter(isObj).map((item) => ({
            nodeId: str(item.nodeId), enabled: item.enabled === true, required: Number(item.required) || 0,
        })),
        createdAt: str(d.createdAt),
        updatedAt: str(d.updatedAt),
    };
}

export async function nextOrgCounter(orgId: string, field: string): Promise<number> {
    const res = await googleRequest(`${FIRESTORE_BASE}:commit`, 'POST', {
        writes: [{ transform: { document: `${DOCUMENT_NAME_ROOT}/organizations/${orgId}`, fieldTransforms: [{ fieldPath: field, increment: { integerValue: '1' } }] } }],
    });
    if (!res.ok) await fail(res, 'Organization counter');
    const data = (await res.json()) as { writeResults?: Array<{ transformResults?: Array<{ integerValue?: string }> }> };
    const value = Number(data.writeResults?.[0]?.transformResults?.[0]?.integerValue);
    if (!Number.isInteger(value) || value < 1) throw new HttpError(500, 'Could not assign the next number. Please try again.');
    return value;
}

function readOperatingLevel(ctx: OrgContext, raw: unknown): string {
    const value = str(raw);
    if (!value || ['legal_entity', 'site', 'department', 'cost_center'].includes(value)) return value;
    const match = /^upper:(\d)$/.exec(value);
    if (match && Number(match[1]) < designOf(ctx.org).names.length) return value;
    throw new HttpError(400, 'Choose where this role operates from the list.');
}

/** Non-super admins can only map security roles whose rights they hold through their own direct role. */
function canGrantPerms(ctx: OrgContext, permissions: string[]): boolean {
    if (ctx.role === 'org_super_admin') return true;
    return permissions.every((p) => p !== '*' && hasPerm(ctx.directPermissions, p));
}

async function securityRoleMap(orgId: string) {
    return new Map(
        (await listDocs(`organizations/${orgId}/roles`)).map((d) => [
            d.id,
            { name: str(d.data.name) || d.id, permissions: Array.isArray(d.data.permissions) ? (d.data.permissions as Plain[]).map(str).filter(Boolean) : [] },
        ])
    );
}

async function allPositions(orgId: string) {
    return (await listDocs(posCol(orgId))).map(positionOut).sort((a, b) => a.code.localeCompare(b.code));
}

function validateStaffingPlan(raw: unknown, operatingLevel: string, nodes: StaffingUnit[]): RoleStaffingRow[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new HttpError(400, 'Role staffing requirements must be a list.');
    const matching = new Set(matchingRoleNodes(operatingLevel, nodes).map(n => n.id));
    const seen = new Set<string>();
    return raw.map((entry) => {
        if (!isObj(entry)) throw new HttpError(400, 'Invalid role staffing row.');
        const nodeId = str(entry.nodeId);
        const enabled = entry.enabled === true;
        const required = Number(entry.required);
        if (!matching.has(nodeId)) throw new HttpError(400, 'Each staffing unit must match the selected operating level.');
        if (seen.has(nodeId)) throw new HttpError(400, 'A unit can only be configured once for this role.');
        seen.add(nodeId);
        if (!Number.isSafeInteger(required) || required < 0 || required > 999999) throw new HttpError(400, 'Required positions must be a non-negative whole number.');
        if (!enabled && required !== 0) throw new HttpError(400, 'Disabled organizational units must have zero required positions.');
        return { nodeId, enabled, required };
    });
}

/** Keep the existing site-role selection aligned with the staffing activation switches.
 * Role requirements remain the source of truth; disabling a staffed unit is blocked first.
 */
async function syncRoleAtSites(orgId: string, roleCode: string, operatingLevel: string, rows: RoleStaffingRow[], nodes: ReturnType<typeof nodeOut>[], uid: string) {
    if (!rows.length) return; // Legacy roles without a configured establishment remain unchanged.
    const enabled = new Set(operatingLevel === 'site' ? rows.filter(r => r.enabled).map(r => r.nodeId) : []);
    for (const site of nodes.filter(n => n.level === 'site')) {
        const before = site.roleCodes;
        const after = enabled.has(site.id)
            ? [...new Set([...before, roleCode])]
            : before.filter(code => code !== roleCode);
        if (after.length !== before.length || after.some((v,i) => v !== before[i])) {
            await updateFields(`${col(orgId)}/${site.id}`, { roleCodes: after, updatedAt: nowIso(), updatedBy: uid });
        }
    }
}

export const positionRoutes = {
    'POST /api/org/reference/core-skills': [orgRoute('org.reference.core_skills',null,async()=>{const doc=await getDoc('module_workspaces/HRM/metadata/skillsMaster');return {ready:!!doc,skills:(Array.isArray(doc?.data.items)?doc.data.items:[]).filter(isObj).map(x=>({code:str(x.code),label:str(x.label),category:str(x.category),subcategory:str(x.subcategory),description:str(x.description),active:x.active!==false}))};})],
    'POST /api/org/positions/list': [
        orgRoute('org.positions.list', null, async (ctx) => {
            const [positions, roles, structure] = await Promise.all([allPositions(ctx.orgId), securityRoleMap(ctx.orgId), listDocs(col(ctx.orgId))]);
            return {
                positions,
                scopeNodes: structure.map(nodeOut).filter(n => SCOPE_LEVELS.includes(n.level)).map(n => ({ id: n.id, level: n.level, tier: n.tier, code: n.code, name: n.name, status: n.status, roleCodes: n.roleCodes })),
                design: designOf(ctx.org),
                roleOptions: Array.from(roles.entries())
                    .filter(([id]) => id !== 'org_super_admin')
                    .map(([id, r]) => ({ id, name: r.name, permissions: r.permissions.length, admin: r.permissions.some((p) => p.startsWith('ADM.')) }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
            };
        }),
    ],

    /** Live staffing occupancy for the selected job role, read from actual user assignments.
     * Primary assignments fill permanent positions. Time-bound acting/secondment is shown separately.
     * Employee names are restricted to organization structure administrators.
     */
    'POST /api/org/positions/staffing': [
        orgRoute('org.positions.staffing', 'ADM.structure', async (ctx) => {
            const code = str(ctx.body.code);
            if (code && !/^ROL_\d{3,6}$/.test(code)) throw new HttpError(400, 'Invalid job role code.');
            if (!code) return { counts: [], asOf: nowIso(), occupiedTotal: 0 };
            const position = await getDoc(`${posCol(ctx.orgId)}/${code}`);
            if (!position) throw new HttpError(404, 'Job role not found.');
            const people = await runQuery({ from: [{ collectionId: 'users' }], where: {
                fieldFilter: { field: { fieldPath: 'orgId' }, op: 'EQUAL', value: { stringValue: ctx.orgId } },
            } });
            const counts = new Map<string, { nodeId: string; filled: number; temporary: number; employees: Array<{ name: string; type: string }> }>();
            const today = nowIso().slice(0, 10);
            for (const person of people) {
                if (['disabled','suspended','deleted','inactive'].includes(str(person.data.status))) continue;
                const raw = readAssignments(person.data.assignments);
                const matched = employmentCoverage(raw, code, today);
                const handled = new Set<string>();
                for (const assignment of matched) {
                    const key = `${assignment.nodeId}:${assignment.type === 'primary' ? 'primary' : 'temporary'}`;
                    if (handled.has(key)) continue;
                    handled.add(key);
                    const item = counts.get(assignment.nodeId) || { nodeId: assignment.nodeId, filled: 0, temporary: 0, employees: [] };
                    const primary = assignment.type === 'primary';
                    if (primary) item.filled++;
                    else item.temporary++;
                    item.employees.push({
                        name: [str(person.data.firstName), str(person.data.lastName)].filter(Boolean).join(' ') || 'Employee',
                        type: primary ? 'primary' : assignment.type,
                    });
                    counts.set(assignment.nodeId, item);
                }
            }
            return { counts: [...counts.values()].sort((a,b) => a.nodeId.localeCompare(b.nodeId)),
                asOf: nowIso(), occupiedTotal: [...counts.values()].reduce((n,v) => n + v.filled, 0) };
        }),
    ],
    'POST /api/org/positions/save': [
        orgRoute('org.positions.save', 'ADM.structure', async (ctx) => {
            const title = text(ctx.body, 'title', 2, 80, 'Enter the role title (2 to 80 characters).');
            const description = text(ctx.body, 'description', 0, 500, 'Description can be up to 500 characters.');
            const operatingLevel = readOperatingLevel(ctx, ctx.body.operatingLevel);
            const defaultNodeId = str(ctx.body.defaultNodeId);
            if (defaultNodeId) { const n = nodeOut(await getNode(ctx, defaultNodeId)); const upper = /^upper:(\d)$/.exec(operatingLevel); if (!operatingLevel || !(n.level === operatingLevel || (upper && n.level === 'group' && n.tier === Number(upper[1])))) throw new HttpError(400, 'Default operating scope must match the job role operating level.'); }
            const parentCode = str(ctx.body.parentCode);
            const code = str(ctx.body.code);
            const rolesMap = await securityRoleMap(ctx.orgId);
            const rawRoles = Array.isArray(ctx.body.securityRoles) ? ctx.body.securityRoles : [];
            if (rawRoles.length > 10) throw new HttpError(400, 'A job role can be mapped to up to 10 security roles.');
            const securityRoles = Array.from(new Set(rawRoles.map(str).filter(Boolean)));
            for (const r of securityRoles) {
                const role = rolesMap.get(r);
                if (!role || r === 'org_super_admin') throw new HttpError(400, 'Choose security roles from the list. The super admin role cannot be mapped.');
            }
            const rawSkills = ctx.body.coreSkills;
            if (rawSkills !== undefined && !Array.isArray(rawSkills)) throw new HttpError(400, 'Core skills must be a list.');
            // No business-imposed minimum or maximum. An empty list is valid. The underlying
            // Firestore document size still applies, as it does to every persisted record.
            const coreSkills = Array.from(new Set((Array.isArray(rawSkills) ? rawSkills : []).map(str).filter(Boolean)));
            const positions = await allPositions(ctx.orgId);
            const nodeDocs = await listDocs(col(ctx.orgId));
            const nodes = nodeDocs.map(nodeOut).filter(n => SCOPE_LEVELS.includes(n.level));
            const staffingPlan = validateStaffingPlan(ctx.body.staffingPlan, operatingLevel, nodes);
            const matchedNodes = matchingRoleNodes(operatingLevel, nodes);
            if (staffingPlan.length && staffingPlan.length !== matchedNodes.length) {
                throw new HttpError(400, 'Configure every organization unit at this role level, even if it is disabled.');
            }
            if (code && staffingPlan.length) {
                // Do not silently disable a location with employees already holding this job role.
                const people = await runQuery({ from: [{ collectionId: 'users' }], where: {
                    fieldFilter: { field: { fieldPath: 'orgId' }, op: 'EQUAL', value: { stringValue: ctx.orgId } },
                } });
                const disabled = new Set(matchedNodes.filter(n =>
                    !staffingPlan.some(p => p.nodeId === n.id && p.enabled)).map(n => n.id));
                for (const person of people) {
                    if (['disabled','suspended','deleted','inactive'].includes(str(person.data.status))) continue;
                    const assigned = employmentCoverage(readAssignments(person.data.assignments), code, nowIso().slice(0,10));
                    if (assigned.some(a => a.type === 'primary' && (disabled.has(a.nodeId) || (staffingPlan.length && !matchedNodes.some(n => n.id === a.nodeId))))) {
                        throw new HttpError(409, 'This role already has an active employee in a disabled unit. Enable the unit or reassign the employee first.');
                    }
                }
            }
            if (coreSkills.length) {
                const skillDoc = await getDoc('module_workspaces/HRM/metadata/skillsMaster');
                const available = new Set((Array.isArray(skillDoc?.data.items) ? skillDoc.data.items : [])
                    .filter(isObj).filter((x) => x.active !== false).map((x) => str(x.code)));
                // Existing assignments remain editable even if a skill was subsequently
                // disabled in HRM. It cannot be newly adopted by another role.
                const savedSkills = new Set(positions.find((p) => p.code === code)?.coreSkills ?? []);
                if (coreSkills.some((x) => !available.has(x) && !savedSkills.has(x))) {
                    throw new HttpError(400, 'Newly added skills must be enabled in HRM Skills Master.');
                }
            }
            if (positions.some((p) => p.code !== code && p.title.toLowerCase() === title.toLowerCase())) throw new HttpError(409, 'Another role already has this title.');
            if (parentCode) {
                if (parentCode === code) throw new HttpError(400, 'A role cannot report to itself.');
                if (!positions.some((p) => p.code === parentCode)) throw new HttpError(400, 'Choose who this role reports to from the list.');
                // Prevent cycles: walking up from the parent must never reach this role.
                let cursor = parentCode;
                for (let i = 0; i < 100 && cursor; i++) {
                    if (cursor === code) throw new HttpError(400, 'That reporting line would create a loop.');
                    cursor = positions.find((p) => p.code === cursor)?.parentCode ?? '';
                }
            }
            const now = nowIso();
            if (code) {
                const existing = positions.find((p) => p.code === code);
                if (!/^ROL_\d{3,6}$/.test(code) || !existing) throw new HttpError(404, 'Role not found.');
                const added = securityRoles.filter((r) => !existing.securityRoles.includes(r));
                const removed = existing.securityRoles.filter((r) => !securityRoles.includes(r));
                if (added.length || removed.length) {
                    if (!canGrantPerms(ctx, [...added, ...removed].flatMap((r) => rolesMap.get(r)?.permissions ?? []))) {
                        throw new HttpError(403, 'You can only map or unmap security roles whose rights you hold yourself.');
                    }
                    const mine = (Array.isArray(ctx.me.data.assignments) ? (ctx.me.data.assignments as Plain[]) : []).filter(isObj).some((a) => str(a.positionCode) === code);
                    if (mine && ctx.role !== 'org_super_admin') throw new HttpError(403, 'You cannot change the security roles of a job role you hold.');
                }
                await updateFields(`${posCol(ctx.orgId)}/${code}`, { title, description, parentCode, operatingLevel, securityRoles, coreSkills, staffingPlan, updatedAt: now, updatedBy: ctx.uid });
                await syncRoleAtSites(ctx.orgId, code, operatingLevel, staffingPlan, nodeDocs.map(nodeOut), ctx.uid);
                await record(ctx, 'org.position.update', `${code} ${title}`, added.length || removed.length ? `Security roles added: ${added.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'}` : '');
                if (added.length || removed.length) clearAccessCache(ctx.orgId);
                return { code };
            }
            if (!canGrantPerms(ctx, securityRoles.flatMap((r) => rolesMap.get(r)?.permissions ?? []))) throw new HttpError(403, 'You can only map security roles whose rights you hold yourself.');
            for (let attempt = 0; attempt < 3; attempt++) {
                const n = await nextOrgCounter(ctx.orgId, 'positionSeq');
                if (n > 999999) throw new HttpError(400, 'Your organization has reached 999999 job roles.');
                const newCode = `ROL_${String(n).padStart(6, '0')}`;
                if (await writeDoc(`${posCol(ctx.orgId)}/${newCode}`, { title, description, parentCode, operatingLevel, securityRoles, coreSkills, staffingPlan, createdAt: now, createdBy: ctx.uid, updatedAt: now }, { exists: false })) {
                    await syncRoleAtSites(ctx.orgId, newCode, operatingLevel, staffingPlan, nodeDocs.map(nodeOut), ctx.uid);
                    if (securityRoles.length) clearAccessCache(ctx.orgId);
                    await record(ctx, 'org.position.create', `${newCode} ${title}`, parentCode ? `Reports to ${parentCode}` : 'Top role');
                    return { code: newCode };
                }
            }
            throw new HttpError(409, 'Could not number the role. Please try again.');
        }),
    ],

    'POST /api/org/positions/delete': [
        orgRoute('org.positions.delete', 'ADM.structure', async (ctx) => {
            const code = str(ctx.body.code);
            const doc = /^ROL_\d{3,6}$/.test(code) ? await getDoc(`${posCol(ctx.orgId)}/${code}`) : null;
            if (!doc) throw new HttpError(404, 'Role not found.');
            const positions = await allPositions(ctx.orgId);
            if (positions.some((p) => p.parentCode === code)) throw new HttpError(400, 'Other roles report to this one. Move or delete them first.');
            const usedAt = await runQuery(
                { from: [{ collectionId: 'structure' }], where: { fieldFilter: { field: { fieldPath: 'roleCodes' }, op: 'ARRAY_CONTAINS', value: { stringValue: code } } }, limit: 1 },
                `organizations/${ctx.orgId}`
            );
            if (usedAt.length) throw new HttpError(400, `This role is selected at ${str(usedAt[0].data.code)}. Remove it from the site first.`);
            const holders = await runQuery({ from: [{ collectionId: 'users' }], where: { fieldFilter: { field: { fieldPath: 'orgId' }, op: 'EQUAL', value: { stringValue: ctx.orgId } } } });
            const held = holders.filter((u) => (Array.isArray(u.data.assignments) ? (u.data.assignments as Plain[]) : []).filter(isObj).some((a) => str(a.positionCode) === code));
            if (held.length) throw new HttpError(400, `${held.length} user(s) hold this role. Remove it from them first.`);
            await deleteDoc(`${posCol(ctx.orgId)}/${code}`);
            await record(ctx, 'org.position.delete', `${code} ${str(doc.data.title)}`);
            clearAccessCache(ctx.orgId);
            return { ok: true };
        }),
    ],

    // Roles are universal for the organization; each site selects the ones it uses.
    'POST /api/org/structure/site-roles': [
        orgRoute('org.structure.site_roles', 'ADM.structure', async (ctx) => {
            const site = await getNode(ctx, str(ctx.body.siteId));
            if (str(site.data.level) !== 'site') throw new HttpError(400, 'Roles are selected at site level.');
            const codes = Array.from(new Set((Array.isArray(ctx.body.roleCodes) ? ctx.body.roleCodes : []).map(str)));
            const valid = new Set((await allPositions(ctx.orgId)).map((p) => p.code));
            const unknown = codes.filter((c) => !valid.has(c));
            if (unknown.length) throw new HttpError(400, `Unknown roles: ${unknown.join(', ')}.`);
            await updateFields(`${col(ctx.orgId)}/${site.id}`, { roleCodes: codes, updatedAt: nowIso(), updatedBy: ctx.uid });
            await record(ctx, 'org.structure.site_roles', `Site ${str(site.data.code)}`, `${codes.length} roles`);
            return { roleCodes: codes };
        }),
    ],

    // Everything needed to draw the organization chart.
    'POST /api/org/structure/tree': [
        orgRoute('org.structure.tree', null, async (ctx) => {
            const [nodes, positions] = await Promise.all([listDocs(col(ctx.orgId)), allPositions(ctx.orgId)]);
            return {
                design: designOf(ctx.org),
                organization: str(ctx.org.data.name),
                nodes: nodes.map(nodeOut).map((n) => ({ id: n.id, level: n.level, tier: n.tier, parentId: n.parentId, code: n.code, name: n.name, status: n.status, managerName: n.managerName, roleCodes: n.roleCodes })),
                positions,
            };
        }),
    ],

    'POST /api/org/reference/banks': [
        orgRoute('org.reference.banks', null, async (ctx) => {
            const country = str(ctx.body.countryCode).toUpperCase();
            const doc = await getDoc('reference/banks');
            const items = (Array.isArray(doc?.data.items) ? (doc?.data.items as Plain[]) : []).filter(isObj);
            return {
                banks: items
                    .filter((b) => !country || str(b.countryCode) === country)
                    .filter((b) => b.active !== false)
                    .map((b) => ({ id: str(b.id), name: str(b.name), shortName: str(b.shortName), swiftCode: str(b.swiftCode), type: str(b.type) })),
            };
        }),
    ],

    'POST /api/org/structure/logo': [
        orgRoute('org.structure.logo', 'ADM.structure', async (ctx) => {
            const node = await getNode(ctx, str(ctx.body.id));
            if (str(node.data.level) !== 'legal_entity') throw new HttpError(400, 'Logos are set on legal entities.');
            await rateLimit('entity-logo', ctx.orgId, 30, 3600);
            const data = str(ctx.body.data);
            if (!data || data.length > 1_500_000 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new HttpError(400, 'The logo must be a PNG or JPEG image under 1 MB.');
            const buf = Buffer.from(data, 'base64');
            if (!buf.length || buf.length > 1_100_000) throw new HttpError(400, 'The logo must be under 1 MB.');
            const detected = detectImage(buf);
            if (!detected) throw new HttpError(400, 'The logo must be a PNG or JPEG image.');
            const path = `organizations/${ctx.orgId}/entities/${node.id}/logo_${randomId(6)}.${detected.ext}`;
            const [ok] = await storage.write([{ path, content: data, contentType: detected.contentType }]);
            if (!ok) throw new HttpError(502, 'The logo could not be stored. Please try again.');
            const previous = str(node.data.logoPath);
            await updateFields(`${col(ctx.orgId)}/${node.id}`, { logoPath: path, updatedAt: nowIso() });
            if (previous.startsWith('organizations/' + ctx.orgId + '/entities/' + node.id + '/logo_')) {
                try { await storage.delete([previous]); }
                catch { console.warn('ENTITY_LOGO_CLEANUP_DEFERRED', ctx.orgId); }
            }
            await record(ctx, 'org.structure.logo', `Legal entity ${str(node.data.code)}`);
            const [signed] = await storage.url([path]);
            return { logoUrl: signed?.url ?? '' };
        }),
    ],

    // Where each user's organization roles apply, plus special view access beyond that scope.
    'POST /api/org/users/scope/get': [
        orgRoute('org.users.scope.get', 'ADM.users', async (ctx) => {
            const uid = str(ctx.body.uid);
            const user = /^[A-Za-z0-9]{6,128}$/.test(uid) ? await getDoc(`users/${uid}`) : null;
            if (!user || str(user.data.orgId) !== ctx.orgId) throw new HttpError(404, 'User not found.');
            const [nodes, positions] = await Promise.all([listDocs(col(ctx.orgId)), allPositions(ctx.orgId)]);
            return {
                assignments: readAssignments(user.data.assignments),
                extraScopes: Array.isArray(user.data.extraScopes) ? (user.data.extraScopes as Plain[]).map(str) : [],
                positions,
                design: designOf(ctx.org),
                nodes: nodes
                    .map(nodeOut)
                    .filter((n) => SCOPE_LEVELS.includes(n.level))
                    .map((n) => ({ id: n.id, level: n.level, tier: n.tier, code: n.code, name: n.name, roleCodes: n.roleCodes }))
                    .sort((a, b) => a.code.localeCompare(b.code)),
            };
        }),
    ],

    'POST /api/org/users/scope/save': [
        orgRoute('org.users.scope.save', 'ADM.users', async (ctx) => {
            const uid = str(ctx.body.uid);
            const user = /^[A-Za-z0-9]{6,128}$/.test(uid) ? await getDoc(`users/${uid}`) : null;
            if (!user || str(user.data.orgId) !== ctx.orgId) throw new HttpError(404, 'User not found.');
            if (uid === ctx.uid && ctx.role !== 'org_super_admin') throw new HttpError(403, 'You cannot change your own job roles or access scope.');
            const [nodeDocs, positions, rolesMap] = await Promise.all([listDocs(col(ctx.orgId)), allPositions(ctx.orgId), securityRoleMap(ctx.orgId)]);
            const nodes = new Map(nodeDocs.map(nodeOut).map((n) => [n.id, n]));
            const posMap = new Map(positions.map((p) => [p.code, p]));
            const seen = new Set<string>();
            const autoAdd = new Set<string>();
            const rawAssignments = (Array.isArray(ctx.body.assignments) ? ctx.body.assignments : []).filter(isObj);
            if (rawAssignments.length > 2) throw new HttpError(400, 'Only one primary role and one temporary assignment are permitted.');
            const assignments = rawAssignments
                .map((a) => {
                    const positionCode = str(a.positionCode);
                    let nodeId = str(a.nodeId);
                    const position = posMap.get(positionCode);
                    
                    if (position && !nodeId) {
                        const upperMatch = /^upper:(\d)$/.exec(position.operatingLevel);
                        const eligible = [...nodes.values()].filter(n => (!position.operatingLevel || position.operatingLevel === n.level || (!!upperMatch && n.level === 'group' && n.tier === Number(upperMatch[1])))); 
                        const prior = readAssignments(user.data.assignments).find(x => x.positionCode === positionCode);
                        if (prior && eligible.some(n => n.id === prior.nodeId)) nodeId = prior.nodeId;
                        else if (eligible.length === 1) nodeId = eligible[0].id;
                        else throw new HttpError(409, eligible.length ? 'Select the user operating location for this job role.' : 'No organizational location exists at this job role operating level.');
                    }
                    if (!position) throw new HttpError(400, 'Choose an organization role from the list.');
                    const node = nodes.get(nodeId);
                    const configured = [...nodes.values()].filter(n => (!position.operatingLevel || n.level === position.operatingLevel || (/^upper:(\d)$/.test(position.operatingLevel) && n.level === 'group' && n.tier === Number(position.operatingLevel.slice(6)))));
                    if (!configured.some(n => n.id === nodeId)) throw new HttpError(409, 'The selected user location does not match the job role operating level or site authorization.');
                    if (!node || !SCOPE_LEVELS.includes(node.level)) throw new HttpError(400, `Choose where ${position.title} applies.`);
                    const level = position.operatingLevel;
                    const upper = /^upper:(\d)$/.exec(level);
                    const fits = !level || (level === node.level) || (!!upper && node.level === 'group' && node.tier === Number(upper[1]));
                    if (!fits) throw new HttpError(400, `${position.title} operates at a different level.`);
                    // A configured establishment decides where new employee assignments are allowed.
                    // Existing assignments are grandfathered only until their location is reconciled.
                    const plan = position.staffingPlan;
                    if (plan.length && !plan.some((r) => r.nodeId === nodeId && r.enabled)) {
                        const wasAssigned = readAssignments(user.data.assignments).some((old) =>
                            old.positionCode === positionCode && old.nodeId === nodeId);
                        if (!wasAssigned) throw new HttpError(409, `${position.title} is not enabled for this organizational unit. Enable it under Job roles first.`);
                    }
                    
                    const type = rawAssignments.indexOf(a) === 0 ? 'primary' : str(a.type);
                    const startsOn = str(a.startsOn);
                    const endsOn = str(a.endsOn);
                    if (type !== 'primary' && !['acting', 'extended_function', 'secondment'].includes(type)) throw new HttpError(400, 'Choose acting, extended function or secondment for the additional role.');
                    if (type !== 'primary' && (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || endsOn < startsOn)) throw new HttpError(400, 'Temporary assignments require valid start and end dates.');
                    return { positionCode, nodeId, type, startsOn: type === 'primary' ? '' : startsOn, endsOn: type === 'primary' ? '' : endsOn };
                })
                .filter((a) => {
                    const key = `${a.positionCode}@${a.nodeId}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            const rawScopes = Array.isArray(ctx.body.extraScopes) ? ctx.body.extraScopes : [];
            if (rawScopes.length && !hasPerm(ctx.directPermissions, 'ADM.scope.site') && ctx.role !== 'org_super_admin') throw new HttpError(403, 'Special viewing scope requires scope administration permission.');
            if (rawScopes.length > 10) throw new HttpError(400, 'Up to 10 special access entries are allowed.');
            const extraScopes = Array.from(new Set(rawScopes.map(str))).map((id) => {
                if (id === 'root') {
                    if (ctx.role !== 'org_super_admin' && !hasPerm(ctx.directPermissions, 'ADM.scope.business')) throw new HttpError(403, 'Whole-business visibility requires specific authorization.');
                    return id;
                }
                const node = nodes.get(id);
                if (!node || !SCOPE_LEVELS.includes(node.level)) throw new HttpError(400, 'Choose special access from the list.');
                if (node.level !== 'site' && ctx.role !== 'org_super_admin' && !hasPerm(ctx.directPermissions, 'ADM.scope.country')) throw new HttpError(403, 'Country or higher visibility requires specific authorization.');
                return id;
            });
            const before = new Set(readAssignments(user.data.assignments).map((a) => `${a.positionCode}@${a.nodeId}`));
            const addedPerms = assignments
                .filter((a) => !before.has(`${a.positionCode}@${a.nodeId}`))
                .flatMap((a) => posMap.get(a.positionCode)?.securityRoles ?? [])
                .flatMap((r) => rolesMap.get(r)?.permissions ?? []);
            if (!canGrantPerms(ctx, addedPerms)) throw new HttpError(403, 'These job roles carry security rights you do not hold yourself. Ask a super admin.');
            for (const id of autoAdd) await updateFields(`${col(ctx.orgId)}/${id}`, { roleCodes: nodes.get(id)?.roleCodes ?? [], updatedAt: nowIso() });
            await updateFields(`users/${uid}`, { assignments, extraScopes, scopeUpdatedAt: nowIso(), scopeUpdatedBy: ctx.uid });
            await record(ctx, 'org.user.scope', str(user.data.email), `${assignments.map((a) => `${a.positionCode}@${nodes.get(a.nodeId)?.code ?? a.nodeId}`).join(', ') || 'no job roles'}; ${extraScopes.length} special access`);
            clearAccessCache(ctx.orgId);
            return { assignments, extraScopes };
        }),
    ],

    // Job roles that can manage a unit at this level (never users or security roles).
    'POST /api/org/structure/manager-roles': [
        orgRoute('org.structure.manager_roles', null, async (ctx) => {
            const { expected, site } = await managerContext(ctx, str(ctx.body.level), str(ctx.body.parentId) || 'root', str(ctx.body.nodeId));
            const selected = new Set(site ? nodeOut(site).roleCodes : []);
            const roles = (await allPositions(ctx.orgId))
                .filter((p) => p.operatingLevel === expected)
                .map((p) => ({ code: p.code, title: p.title, selectedAtSite: !site || selected.has(p.code) }));
            return { roles, expected, siteCode: site ? str(site.data.code) : '', siteName: site ? str(site.data.name) : '' };
        }),
    ],

    // A legal entity's 3-letter code can be changed while nothing has been built under it.
    'POST /api/org/structure/recode': [
        orgRoute('org.structure.recode', 'ADM.structure', async (ctx) => {
            const node = await getNode(ctx, str(ctx.body.id));
            if (str(node.data.level) !== 'legal_entity') throw new HttpError(400, 'Only legal entity codes can be changed.');
            if ((await childrenOf(ctx.orgId, node.id)).length) throw new HttpError(400, 'The code can only change before sites are added under this legal entity.');
            const segment = str(ctx.body.segment).trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(segment)) throw new HttpError(400, 'The code must be exactly 3 capital letters.');
            if (segment === node.id) return { id: node.id };
            if (!ID_RE.test(segment)) throw new HttpError(400, 'Invalid code.');
            const ok = await writeDoc(`${col(ctx.orgId)}/${segment}`, { ...node.data, segment, code: segment, updatedAt: nowIso(), updatedBy: ctx.uid }, { exists: false });
            if (!ok) throw new HttpError(409, `The code ${segment} is already used.`);
            await deleteDoc(`${col(ctx.orgId)}/${node.id}`);
            await record(ctx, 'org.structure.recode', `Legal entity ${node.id} → ${segment}`, str(node.data.name));
            return { id: segment };
        }),
    ],
};
