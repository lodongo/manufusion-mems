import { HttpError, getDoc, listDocs, nowIso, randomId, str, updateFields, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { verifiedPeople, ROOM_PATH, CHAT_ROOT, membersOf } from './chatCommon';

const root = (orgId: string) => 'organizations/' + orgId + '/work_groups';
const valid = (id: string) => /^wg_[A-Za-z0-9_-]{12,55}$/.test(id);
const unique = (input: unknown) => [...new Set(Array.isArray(input) ? input.map(str).filter(Boolean) : [])];
const view = (d: Doc) => ({
    id: d.id, name: str(d.data.name), memberUids: unique(d.data.memberUids),
    ownerUid: str(d.data.ownerUid), chatRoomId: str(d.data.chatRoomId),
    updatedAt: str(d.data.updatedAt),
});
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
        const visible = all.filter(d => unique(d.data.memberUids).includes(ctx.uid));
        return { groups: visible.map(view).sort((a, b) => a.name.localeCompare(b.name)) };
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
        return { group: view((await getDoc(root(ctx.orgId) + '/' + id))!) };
    })],
    'POST /api/org/work-groups/update': [orgRoute('workgroups.update', null, async ctx => {
        const g = await readWorkGroup(ctx, str(ctx.body.groupId));
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
        return { group: view((await getDoc(root(ctx.orgId) + '/' + g.id))!) };
    })],
};
