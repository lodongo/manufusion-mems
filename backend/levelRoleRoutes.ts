import { HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { additionalRoleIds, clearAccessCache, directRoleIds, orgRoute, type OrgContext } from './guards';
import { canGrant, catalogue, orgUsers, record } from './org';
import { groupLabels, permissionsDigest, sodConflicts } from './permissionPolicy';
import { LEVEL_ROLES, LEVEL_ROLE_IDS, suggestLevel, type LevelRole } from './levelRoles';

// Standard level roles: list the ladder per module, install levels (with their written rules), and consolidate the
// many older single-purpose roles into levels. Consolidation re-points job roles and direct user assignments, so it
// is a super-admin action with a written reason and a typed confirmation, never merges duties that must stay apart,
// and is audited move by move.

const MAX_CUSTOM_ROLES = 100;
const CONFIRM = 'CONSOLIDATE';
const asList = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(str).filter(Boolean) : []);
const RESERVED = new Set(['org_super_admin', 'org_user', 'default_security']);

/** A level as this organization can have it: only the rights of modules it has adopted. */
async function offeredLevels(ctx: OrgContext): Promise<Array<LevelRole & { available: boolean }>> {
    const groups = await catalogue(ctx.org);
    const offered = new Set(groups.flatMap((g) => g.permissions.map((p) => p.key)));
    return LEVEL_ROLES.map((r) => {
        const permissions = r.permissions.filter((k) => offered.has(k));
        return { ...r, permissions, available: permissions.length === r.permissions.length };
    });
}

function docFor(r: LevelRole) {
    const labels = groupLabels(r.permissions).map((g) => `${g.module}: ${g.items.join('; ')}`).join('\n');
    return {
        purpose: `${r.name} (${r.module} level ${r.rank}). ${r.description}`.slice(0, 400),
        audience: `Employees working at ${r.level.toLowerCase()} level in ${r.moduleName.toLowerCase()}, assigned through their job role or directly.`.slice(0, 400),
        allows: labels.slice(0, 1200) || r.permissions.join(', ').slice(0, 1200),
        never: r.never.slice(0, 800),
        limits: 'Amounts and approval levels come from the chart of authority and the job role, never from this security role. Work is limited to the places the person is assigned.'.slice(0, 800),
        rules: [
            '1. Act only through MEMS; every action is audited.',
            '2. Never approve, verify or post your own work: the system blocks it, and the organization expects it to be reported if seen.',
            `3. ${r.never}`,
            '4. Report any access you should not have to the security administrator.',
        ].join('\n'),
    };
}

async function writeLevelDoc(ctx: OrgContext, r: LevelRole) {
    const path = `organizations/${ctx.orgId}/role_docs/${r.id}`;
    if (await getDoc(path)) return;
    const now = nowIso();
    const data = { ...docFor(r), version: 1, nextReview: '', reviewedDigest: permissionsDigest(r.permissions), createdAt: now, updatedAt: now, createdBy: ctx.uid, updatedBy: ctx.uid };
    if (await writeDoc(path, data, { exists: false })) await writeDoc(`${path}/versions/1`, { ...data, reason: 'Standard level role rules' }, { exists: false });
}

interface Move { from: Doc; to: LevelRole; lost: string[]; gained: string[] }

export const levelRoleRoutes = {
    'POST /api/org/roles/levels': [
        orgRoute('org.roles.levels', 'ADM.roles', async (ctx) => {
            const [levels, roles, users, positions] = await Promise.all([offeredLevels(ctx), listDocs(`organizations/${ctx.orgId}/roles`), orgUsers(ctx.orgId), listDocs(`organizations/${ctx.orgId}/positions`)]);
            const installed = new Set(roles.map((r) => r.id));
            const usedBy = (id: string) => ({
                users: users.filter((u) => directRoleIds(u).includes(id)).length,
                jobRoles: positions.filter((p) => asList(p.data.securityRoles).includes(id)).map((p) => p.id),
            });
            const ready = levels.filter((l) => installed.has(l.id) && l.available);
            const others = roles.filter((r) => !RESERVED.has(r.id) && r.data.system !== true && !LEVEL_ROLE_IDS.has(r.id));
            return {
                levels: levels.map((l) => ({
                    id: l.id, module: l.module, moduleName: l.moduleName, rank: l.rank, level: l.level, name: l.name, description: l.description,
                    never: l.never, permissions: l.permissions, available: l.available, installed: installed.has(l.id),
                    grantable: canGrant(ctx, l.permissions), ...usedBy(l.id),
                })),
                existing: others.map((r) => {
                    const perms = asList(r.data.permissions);
                    const s = suggestLevel(perms, ready);
                    return { id: r.id, name: str(r.data.name), permissions: perms.length, ...usedBy(r.id), target: s.target ? { id: s.target.id, name: s.target.name } : null, lost: s.lost, gained: s.gained };
                }).sort((a, b) => a.name.localeCompare(b.name)),
                canConsolidate: ctx.role === 'org_super_admin',
                confirmPhrase: CONFIRM,
            };
        }),
    ],

    'POST /api/org/roles/levels/install': [
        orgRoute('org.roles.levels.install', 'ADM.roles', async (ctx) => {
            const ids = Array.from(new Set(asList(ctx.body.ids))).slice(0, LEVEL_ROLES.length);
            if (!ids.length) throw new HttpError(400, 'Choose at least one level role.');
            const [levels, roles] = await Promise.all([offeredLevels(ctx), listDocs(`organizations/${ctx.orgId}/roles`)]);
            const names = new Map(roles.map((r) => [str(r.data.name).toLowerCase(), r.id]));
            const have = new Set(roles.map((r) => r.id));
            const created: string[] = [];
            const skipped: Array<{ id: string; reason: string }> = [];
            for (const id of ids) {
                const l = levels.find((x) => x.id === id);
                if (!l) { skipped.push({ id, reason: 'Unknown level role.' }); continue; }
                if (have.has(l.id)) { skipped.push({ id, reason: 'Already installed.' }); continue; }
                if (!l.available) { skipped.push({ id, reason: `${l.moduleName} is not adopted by your organization.` }); continue; }
                if (!canGrant(ctx, l.permissions)) { skipped.push({ id, reason: 'It carries rights you do not hold yourself.' }); continue; }
                if (sodConflicts(l.permissions).length) { skipped.push({ id, reason: 'It would combine duties that must stay apart.' }); continue; }
                // An older role with the same name (e.g. "Inventory Viewer") is renamed "(previous)" so it can be
                // consolidated into the level; its rights and holders are untouched.
                const clash = names.get(l.name.toLowerCase());
                if (clash && clash !== l.id) {
                    const old = roles.find((r) => r.id === clash);
                    if (!old || old.data.system === true || RESERVED.has(clash)) { skipped.push({ id, reason: `A system role is already named ${l.name}.` }); continue; }
                    const renamed = `${l.name} (previous)`.slice(0, 60);
                    if (names.has(renamed.toLowerCase())) { skipped.push({ id, reason: `Rename the existing ${l.name} role first.` }); continue; }
                    await writeDoc(`organizations/${ctx.orgId}/roles/${clash}`, { ...old.data, name: renamed, updatedAt: nowIso(), updatedBy: ctx.uid }, { updateTime: old.updateTime });
                    await record(ctx, 'org.role.rename', str(old.data.name), `Renamed to ${renamed} to make way for the standard level role ${l.name}. Rights and holders unchanged.`);
                    names.delete(l.name.toLowerCase());
                    names.set(renamed.toLowerCase(), clash);
                }
                const now = nowIso();
                const ok = await writeDoc(`organizations/${ctx.orgId}/roles/${l.id}`, {
                    name: l.name, description: l.description, permissions: l.permissions, system: false,
                    template: l.id, level: { module: l.module, rank: l.rank, level: l.level }, createdAt: now, updatedAt: now, createdBy: ctx.uid,
                }, { exists: false });
                if (!ok) { skipped.push({ id, reason: 'Already installed.' }); continue; }
                await writeLevelDoc(ctx, l);
                await record(ctx, 'org.role.level.install', l.name, `${l.module} level ${l.rank}: ${l.permissions.join(', ')}`.slice(0, 1800));
                created.push(l.name);
                names.set(l.name.toLowerCase(), l.id);
            }
            clearAccessCache(ctx.orgId);
            return { created, skipped };
        }),
    ],

    /** Move job roles and users from older roles onto level roles, then remove the older roles. */
    'POST /api/org/roles/levels/consolidate': [
        orgRoute('org.roles.levels.consolidate', 'ADM.roles', async (ctx) => {
            if (ctx.role !== 'org_super_admin') throw new HttpError(403, 'Only an organization super admin can consolidate security roles.');
            if (str(ctx.body.confirmation).trim() !== CONFIRM) throw new HttpError(400, `Type ${CONFIRM} to confirm.`);
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 20 || reason.length > 300) throw new HttpError(400, 'Give the reason for consolidating (20 to 300 characters).');
            const raw = (Array.isArray(ctx.body.moves) ? ctx.body.moves : []).filter(isObj).slice(0, 100);
            if (!raw.length) throw new HttpError(400, 'Choose at least one role to consolidate.');
            const acceptLoss = ctx.body.acceptLoss === true;
            const root = `organizations/${ctx.orgId}`;
            const [roles, users, positions, levels] = await Promise.all([listDocs(`${root}/roles`), orgUsers(ctx.orgId), listDocs(`${root}/positions`), offeredLevels(ctx)]);
            const roleById = new Map(roles.map((r) => [r.id, r]));
            const permsOf = (id: string) => asList(roleById.get(id)?.data.permissions);
            const moves: Move[] = [];
            const skipped: Array<{ id: string; reason: string }> = [];
            for (const m of raw) {
                const fromId = str(m.from), toId = str(m.to);
                const from = roleById.get(fromId);
                const to = levels.find((l) => l.id === toId);
                if (!from || RESERVED.has(fromId) || from.data.system === true || LEVEL_ROLE_IDS.has(fromId)) { skipped.push({ id: fromId, reason: 'Only older custom roles can be consolidated.' }); continue; }
                if (!to || !roleById.has(to.id)) { skipped.push({ id: fromId, reason: 'Install the target level role first.' }); continue; }
                const before = permsOf(fromId);
                const after = permsOf(to.id);
                const lost = before.filter((p) => !after.includes(p));
                const gained = after.filter((p) => !before.includes(p));
                if (lost.length && !acceptLoss) { skipped.push({ id: fromId, reason: `Holders would lose ${lost.join(', ')}. Accept the loss of rights to continue.` }); continue; }
                moves.push({ from, to, lost, gained });
            }
            // Duties that must stay apart are checked on what each person and each job role would hold afterwards.
            const mapOf = new Map(moves.map((m) => [m.from.id, m.to.id]));
            const remap = (ids: string[]) => Array.from(new Set(ids.map((id) => mapOf.get(id) ?? id)));
            const union = (ids: string[]) => Array.from(new Set(ids.flatMap((id) => permsOf(id))));
            const blocked = new Set<string>();
            for (const p of positions) {
                const now = asList(p.data.securityRoles);
                if (!now.some((id) => mapOf.has(id))) continue;
                const conflicts = sodConflicts(union(remap(now)));
                if (conflicts.length) for (const id of now.filter((x) => mapOf.has(x))) { blocked.add(id); skipped.push({ id, reason: `Job role ${p.id} would combine duties that must stay apart (${conflicts.map((c) => c.id).join(', ')}).` }); }
            }
            const jobRolesOf = (u: Doc) => (Array.isArray(u.data.assignments) ? (u.data.assignments as unknown[]) : []).filter(isObj).map((a) => str(a.positionCode));
            const securityOfJob = new Map(positions.map((p) => [p.id, asList(p.data.securityRoles)]));
            for (const u of users) {
                const direct = directRoleIds(u);
                const moving = direct.filter((id) => mapOf.has(id));
                if (!moving.length) continue;
                const held = [...direct, ...jobRolesOf(u).flatMap((j) => securityOfJob.get(j) ?? [])];
                const conflicts = sodConflicts(union(remap(held)));
                if (conflicts.length) for (const id of moving) { blocked.add(id); skipped.push({ id, reason: `${str(u.data.email)} would combine duties that must stay apart (${conflicts.map((c) => c.id).join(', ')}).` }); }
            }
            const go = moves.filter((m) => !blocked.has(m.from.id));
            for (const m of go) if (!canGrant(ctx, [...permsOf(m.from.id), ...m.to.permissions])) throw new HttpError(403, 'You cannot move rights you do not hold yourself.');
            const done: Array<{ from: string; to: string; jobRoles: number; users: number }> = [];
            const goMap = new Map(go.map((m) => [m.from.id, m.to.id]));
            for (const p of positions) {
                const now = asList(p.data.securityRoles);
                if (!now.some((id) => goMap.has(id))) continue;
                const next = Array.from(new Set(now.map((id) => goMap.get(id) ?? id)));
                await writeDoc(`${root}/positions/${p.id}`, { ...p.data, securityRoles: next, updatedAt: nowIso(), updatedBy: ctx.uid }, { updateTime: p.updateTime });
            }
            // Each person is rewritten once: primary and additional roles move to their levels (no duplicates).
            for (const u of users) {
                const direct = directRoleIds(u);
                if (!direct.some((id) => goMap.has(id))) continue;
                const primary = str(u.data.role);
                const nextPrimary = goMap.get(primary) ?? primary;
                const nextExtra = Array.from(new Set(additionalRoleIds(u).map((id) => goMap.get(id) ?? id))).filter((id) => id !== nextPrimary);
                await writeDoc(`users/${u.id}`, { ...u.data, role: nextPrimary, additionalRoles: nextExtra }, { updateTime: u.updateTime });
            }
            for (const m of go) {
                const affectedUsers = users.filter((u) => directRoleIds(u).includes(m.from.id));
                const jobs = positions.filter((p) => asList(p.data.securityRoles).includes(m.from.id)).length;
                await deleteDoc(`${root}/roles/${m.from.id}`);
                await record(ctx, 'org.role.consolidate', str(m.from.data.name), `Into ${m.to.name}: ${jobs} job role(s), ${affectedUsers.length} user(s). Lost: ${m.lost.join(', ') || 'none'}. Gained: ${m.gained.join(', ') || 'none'}. Reason: ${reason}`.slice(0, 1800));
                done.push({ from: str(m.from.data.name), to: m.to.name, jobRoles: jobs, users: affectedUsers.length });
            }
            clearAccessCache(ctx.orgId);
            await record(ctx, 'org.roles.consolidate', 'Security roles', `${done.length} role(s) consolidated into level roles, ${skipped.length} skipped. Reason: ${reason}`);
            return { done, skipped, maxCustomRoles: MAX_CUSTOM_ROLES };
        }),
    ],
};
