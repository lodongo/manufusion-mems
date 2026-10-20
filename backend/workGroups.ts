import { createHash } from 'node:crypto';
import { HttpError, getDoc, listDocs, nowIso, randomId, str, updateFields, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { audit } from './audit';
import { verifiedPeople, ROOM_PATH, CHAT_ROOT, membersOf, people, displayName, notify, notifyRoom } from './chatCommon';
import { AUTO_TEAM_KINDS, AUTO_TEAM_LABEL, activeAssignments, computeAutoTeams, type AutoTeamKind } from './autoTeamRules';

// Work groups (teams) are shared by Chat and Email. Besides the groups people create, every person gets
// automatic teams from the reporting lines (reportees, peers, extended team). Automatic teams are refreshed
// whenever the groups are listed: membership follows the organization design, the linked Chat group is
// reconciled (new members invited, people who left the reporting line removed) and every change is audited.

const root = (orgId: string) => 'organizations/' + orgId + '/work_groups';
const valid = (id: string) => /^wg_[A-Za-z0-9_-]{12,55}$/.test(id);
const unique = (input: unknown) => [...new Set(Array.isArray(input) ? input.map(str).filter(Boolean) : [])];
const isAuto = (d: Doc) => (AUTO_TEAM_KINDS as readonly string[]).includes(str(d.data.automatic));
const view = (d: Doc, uid = '') => {
    const kind = str(d.data.automatic) as AutoTeamKind;
    const auto = isAuto(d);
    return {
        id: d.id,
        name: auto && str(d.data.ownerUid) === uid ? AUTO_TEAM_LABEL[kind].mine : str(d.data.name),
        memberUids: unique(d.data.memberUids),
        ownerUid: str(d.data.ownerUid), chatRoomId: str(d.data.chatRoomId),
        updatedAt: str(d.data.updatedAt),
        automatic: auto ? kind : '',
        detail: auto ? (str(d.data.ownerUid) === uid ? AUTO_TEAM_LABEL[kind].detail : 'Automatic team from reporting lines') : '',
    };
};
const autoId = (orgId: string, uid: string, kind: AutoTeamKind) => 'wg_auto_' + kind + '_' + createHash('sha256').update(orgId + ':' + uid).digest('hex').slice(0, 16);

/** Keep a linked Chat group in step with an automatic team: invite new members, remove people who left. */
async function reconcileRoom(ctx: OrgContext, group: Doc, members: string[]) {
    const roomId = str(group.data.chatRoomId);
    if (!roomId) return;
    const room = await getDoc(ROOM_PATH(ctx.orgId, roomId));
    if (!room || str(room.data.kind) !== 'group' || str(room.data.createdBy) !== str(group.data.ownerUid)) return;
    const want = new Set(members);
    const owner = str(group.data.ownerUid);
    const accepted = membersOf(room).filter((u) => want.has(u) || u === owner);
    const pending = unique(room.data.pendingInvites).filter((u) => want.has(u) && !accepted.includes(u));
    const fresh = members.filter((u) => u !== owner && !accepted.includes(u) && !pending.includes(u));
    const removed = membersOf(room).filter((u) => !accepted.includes(u));
    const revoked = unique(room.data.pendingInvites).filter((u) => !pending.includes(u));
    if (!fresh.length && !removed.length && !revoked.length) return;
    const admins = unique(room.data.admins).filter((u) => accepted.includes(u));
    const saved = await writeDoc(ROOM_PATH(ctx.orgId, roomId), { ...room.data, members: accepted, pendingInvites: [...pending, ...fresh], admins: admins.length ? admins : [owner], updatedAt: nowIso() }, { updateTime: room.updateTime });
    if (!saved) return; // Changed concurrently: the next refresh reconciles again.
    await audit([{ category: 'interaction', action: 'chat.group.auto_sync', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { type: 'chat_room', id: roomId },
        details: `Automatic team ${str(group.data.automatic)} · invited ${fresh.length} · removed ${removed.length} · invitations withdrawn ${revoked.length}` }]);
    const updated = await getDoc(ROOM_PATH(ctx.orgId, roomId));
    if (updated) await notifyRoom(ctx, updated);
    for (const u of [...fresh, ...removed, ...revoked]) await notify(ctx, 'chat.inbox', u);
}

/** Create or refresh the person's automatic teams from the current reporting lines. */
export async function syncAutomaticTeams(ctx: OrgContext, existing: Doc[]): Promise<Doc[]> {
    const [roster, positions, structure] = await Promise.all([
        people(ctx),
        listDocs('organizations/' + ctx.orgId + '/positions'),
        listDocs('organizations/' + ctx.orgId + '/structure'),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const teams = computeAutoTeams(
        ctx.uid,
        roster.map((u) => ({ uid: u.id, assignments: activeAssignments(u.data.assignments, today) })),
        new Map(positions.map((p) => [p.id, str(p.data.parentCode)])),
        new Map(structure.map((n) => [n.id, str(n.data.parentId)])),
    );
    const out: Doc[] = [];
    const ownerName = displayName(ctx.me);
    for (const kind of AUTO_TEAM_KINDS) {
        const id = autoId(ctx.orgId, ctx.uid, kind);
        const path = root(ctx.orgId) + '/' + id;
        const before = existing.find((d) => d.id === id) ?? null;
        const members = [ctx.uid, ...teams[kind].filter((u) => u !== ctx.uid)];
        if (!before && members.length < 2) continue;
        const same = before && JSON.stringify([...unique(before.data.memberUids)].sort()) === JSON.stringify([...members].sort());
        if (!before) {
            await writeDoc(path, { name: AUTO_TEAM_LABEL[kind].theirs(ownerName), memberUids: members, ownerUid: ctx.uid, automatic: kind, chatRoomId: '', createdAt: nowIso(), updatedAt: nowIso() }, { exists: false });
            await audit([{ category: 'interaction', action: 'workgroups.auto.create', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { type: 'work_group', id }, details: `${kind} · ${members.length - 1} colleagues from reporting lines` }]);
        } else if (!same) {
            const was = unique(before.data.memberUids);
            await updateFields(path, { memberUids: members, name: AUTO_TEAM_LABEL[kind].theirs(ownerName), updatedAt: nowIso() });
            await audit([{ category: 'interaction', action: 'workgroups.auto.sync', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { type: 'work_group', id },
                details: `${kind} · added ${members.filter((u) => !was.includes(u)).length} · removed ${was.filter((u) => !members.includes(u)).length}` }]);
        }
        const doc = await getDoc(path);
        if (!doc) continue;
        if (!same) await reconcileRoom(ctx, doc, members);
        out.push(doc);
    }
    return out;
}
export async function readWorkGroup(ctx: OrgContext, groupId: string): Promise<Doc> {
    if (!valid(groupId)) throw new HttpError(400, 'Choose a valid work group.');
    const d = await getDoc(root(ctx.orgId) + '/' + groupId);
    if (!d || !unique(d.data.memberUids).includes(ctx.uid)) throw new HttpError(403, 'Work group is not accessible.');
    return d;
}
export async function fromChat(ctx: OrgContext, roomId: string, name: string, members: string[], groupId = '') {
    if (groupId) {
        const g = await readWorkGroup(ctx, groupId);
        const selected = [...new Set([ctx.uid, ...members])];
        if (str(g.data.chatRoomId)) throw new HttpError(409, 'This work group already has a Chat conversation.');
        if (selected.some(m => !unique(g.data.memberUids).includes(m))) throw new HttpError(403, 'Choose only this work group’s colleagues.');
        await updateFields(root(ctx.orgId) + '/' + groupId, { chatRoomId: roomId, updatedAt: nowIso() });
        return groupId;
    }
    const id = 'wg_' + randomId(13);
    await writeDoc(root(ctx.orgId) + '/' + id, {
        name, memberUids: [...new Set([ctx.uid, ...members])], ownerUid: ctx.uid,
        chatRoomId: roomId, createdAt: nowIso(), updatedAt: nowIso(),
    }, { exists: false });
    return id;
}
export async function syncFromChat(ctx: OrgContext, room: Doc) {
    const groupId = str(room.data.workGroupId);
    if (!groupId || !valid(groupId)) return;
    const old = await getDoc(root(ctx.orgId) + '/' + groupId);
    if (!old || str(old.data.chatRoomId) !== room.id) return;
    const pending = unique(room.data.pendingInvites);
    const members = [...new Set([...membersOf(room), ...pending])];
    await updateFields(root(ctx.orgId) + '/' + groupId, {
        name: str(room.data.title), memberUids: members, updatedAt: nowIso(),
    });
}
export const workGroupRoutes = {
    'POST /api/org/work-groups/list': [orgRoute('workgroups.list', null, async ctx => {
        const [all,chatRooms] = await Promise.all([listDocs(root(ctx.orgId)),listDocs(CHAT_ROOT(ctx.orgId))]);
        for (const room of chatRooms.filter(r => str(r.data.kind)==='group' && membersOf(r).includes(ctx.uid))) {
            if (all.some(g => str(g.data.chatRoomId)===room.id)) continue;
            const legacyId='wg_'+room.id;
            const members=[...new Set([...membersOf(room),...unique(room.data.pendingInvites)])];
            const migrated=await writeDoc(root(ctx.orgId)+'/'+legacyId,{
                name:str(room.data.title),memberUids:members,ownerUid:str(room.data.createdBy),
                chatRoomId:room.id,createdAt:str(room.data.createdAt)||nowIso(),updatedAt:nowIso(),
            },{exists:false});
            if (migrated){const d=await getDoc(root(ctx.orgId)+'/'+legacyId);if(d)all.push(d);}
            if (!str(room.data.workGroupId))await updateFields(ROOM_PATH(ctx.orgId,room.id),{workGroupId:legacyId});
        }
        const autos = await syncAutomaticTeams(ctx, all.filter(isAuto));
        const merged = [...all.filter(d => !autos.some(a => a.id === d.id)), ...autos];
        // Automatic teams with nobody else in them stay hidden until the reporting lines fill them.
        const visible = merged.filter(d => unique(d.data.memberUids).includes(ctx.uid) && !(isAuto(d) && unique(d.data.memberUids).length < 2));
        return { groups: visible.map(d => view(d, ctx.uid)).sort((a, b) => (a.automatic ? 0 : 1) - (b.automatic ? 0 : 1) || a.name.localeCompare(b.name)) };
    })],
    'POST /api/org/work-groups/create': [orgRoute('workgroups.create', null, async ctx => {
        const name = str(ctx.body.name).trim().slice(0, 90);
        const ids = unique(ctx.body.memberUids).filter(id => id !== ctx.uid);
        if (name.length < 3 || !ids.length || ids.length > 49) throw new HttpError(400, 'Enter a group name and select 1–49 colleagues.');
        await verifiedPeople(ctx, [ctx.uid, ...ids]);
        const duplicate = (await listDocs(root(ctx.orgId))).some(g => str(g.data.ownerUid) === ctx.uid
            && str(g.data.name).toLowerCase() === name.toLowerCase());
        if (duplicate) throw new HttpError(409, 'You already have a work group with that name.');
        const id = 'wg_' + randomId(13);
        await writeDoc(root(ctx.orgId) + '/' + id, {
            name, memberUids: [ctx.uid, ...ids], ownerUid: ctx.uid,
            chatRoomId: '', createdAt: nowIso(), updatedAt: nowIso(),
        }, { exists: false });
        await audit([{ category: 'interaction', action: 'workgroups.create', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { type: 'work_group', id }, details: `${name} · ${ids.length} colleagues` }]);
        return { group: view((await getDoc(root(ctx.orgId) + '/' + id))!, ctx.uid) };
    })],
    'POST /api/org/work-groups/update': [orgRoute('workgroups.update', null, async ctx => {
        const g = await readWorkGroup(ctx, str(ctx.body.groupId));
        if (isAuto(g)) throw new HttpError(403, 'Automatic teams follow the reporting lines in Organization design and cannot be edited by hand.');
        if (str(g.data.ownerUid) !== ctx.uid) throw new HttpError(403, 'Only the creator may change the group.');
        const name = str(ctx.body.name).trim().slice(0, 90);
        const ids = unique(ctx.body.memberUids).filter(id => id !== ctx.uid);
        if (name.length < 3 || ids.length < 1 || ids.length > 49) throw new HttpError(400, 'Enter a name and choose members.');
        await verifiedPeople(ctx, [ctx.uid, ...ids]);
        const members = [ctx.uid, ...ids];
        const roomId = str(g.data.chatRoomId);
        if (roomId) {
            const room = await getDoc(ROOM_PATH(ctx.orgId, roomId));
            if (room && str(room.data.kind) === 'group' && membersOf(room).includes(ctx.uid)) {
                if (str(room.data.createdBy) !== ctx.uid) throw new HttpError(403, 'Only the Chat group creator can edit a linked group.');
                const accepted = membersOf(room).filter(uid => members.includes(uid));
                const invited = unique(room.data.pendingInvites).filter(uid => members.includes(uid));
                const all = [...new Set([...accepted, ...invited])];
                const fresh = members.filter(uid => !all.includes(uid));
                await updateFields(ROOM_PATH(ctx.orgId, roomId), {
                    title: name, members: accepted, pendingInvites: [...invited, ...fresh],
                    updatedAt: nowIso(),
                });
            }
        }
        await updateFields(root(ctx.orgId) + '/' + g.id, { name, memberUids: members, updatedAt: nowIso() });
        const was = unique(g.data.memberUids);
        await audit([{ category: 'interaction', action: 'workgroups.update', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { type: 'work_group', id: g.id },
            details: `${name} · added ${members.filter(u => !was.includes(u)).length} · removed ${was.filter(u => !members.includes(u)).length}${roomId ? ' · Chat group synced' : ''}` }]);
        return { group: view((await getDoc(root(ctx.orgId) + '/' + g.id))!, ctx.uid) };
    })],
};
