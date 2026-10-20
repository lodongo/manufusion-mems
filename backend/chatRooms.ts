import { HttpError, encodeValue, getDoc, isObj, listDocs, nowIso, randomId, runQuery, str, updateFields, writeDoc, deleteDoc } from './core';
import { orgRoute } from './guards';
import { audit } from './audit';
import { fromChat, readWorkGroup, syncFromChat } from './workGroups';
import {
    CHAT_ROOT, ROOM_PATH, MAX_GROUP,
    checkedRoom, directId, displayName, isCurrentMember, membersOf,
    notifyRoom, notify, people, photoUrl, verifiedPeople,
} from './chatCommon';
import { lastMessageStatus, waitForChanges } from './chatLive';

function stamp(ctx: { actor: any; orgId: string; meta: any }, action: string, id: string) {
    return audit([{
        category: 'interaction', action, actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId,
        target: { type: 'chat_conversation', id }, details: 'Organization-scoped chat action',
    }]);
}
const roomView = (id: string, d: Record<string, unknown>) => ({
    id,
    kind: str(d.kind) === 'group' ? 'group' : 'direct',
    title: str(d.title), description: str(d.description), workGroupId: str(d.workGroupId),
    members: Array.isArray(d.members) ? d.members.map(str) : [],
    pendingInvites: Array.isArray(d.pendingInvites) ? d.pendingInvites.map(str) : [],
    admins: Array.isArray(d.admins) ? d.admins.map(str) : [],
    createdBy: str(d.createdBy),
    lastMessage: str(d.lastMessage), lastSenderUid: str(d.lastSenderUid),
    lastMessageAt: str(d.lastMessageAt), lastMessageKind: str(d.lastMessageKind) || 'text',
    sendPolicy: str(d.sendPolicy) === 'admins' ? 'admins' : 'all',
    infoPolicy: str(d.infoPolicy) === 'all' ? 'all' : 'admins',
    updatedAt: str(d.updatedAt), createdAt: str(d.createdAt),
});
const prefPath = (uid: string, roomId: string) => 'users/' + uid + '/chat_hidden/' + roomId;

export const chatRoomRoutes = {
    'POST /api/org/quick/chat/people': [orgRoute('chat.people', null, async (ctx) => {
        const found = await people(ctx);
        return {
            people: await Promise.all(found.sort((a,b) => displayName(a).localeCompare(displayName(b))).map(async (u) => ({
                uid: u.id, name: displayName(u), photoUrl: await photoUrl(u),
                email: str(u.data.email), role: str(u.data.role),
            }))),
        };
    })],
    'POST /api/org/quick/chat/list': [orgRoute('chat.list', null, async (ctx) => {
        const [all, hidden, prefs] = await Promise.all([listDocs(CHAT_ROOT(ctx.orgId)),
            listDocs('users/' + ctx.uid + '/chat_hidden'), listDocs('users/' + ctx.uid + '/chat_prefs')]);
        const prefMap = new Map(prefs.map((d) => [d.id, d.data]));
        const now = Date.now();
        const hiddenMap = new Map(hidden.map((d) => [d.id, str(d.data.hiddenAt)]));
        const rooms = all.filter((d) => isCurrentMember(d, ctx.uid) && (
            !hiddenMap.has(d.id) || str(d.data.updatedAt) > (hiddenMap.get(d.id) || '')
        )).sort((a,b) => str(b.data.updatedAt).localeCompare(str(a.data.updatedAt)));
        const visible = rooms.slice(0, 250);
        return { rooms: await Promise.all(visible.map(async (d, index) => {
            const read = await getDoc(ROOM_PATH(ctx.orgId, d.id) + '/read_marks/' + ctx.uid);
            const lastMessageAt = str(d.data.lastMessageAt);
            const readAt = str(read?.data.readAt);
            const unread = str(d.data.lastSenderUid) !== ctx.uid && !!lastMessageAt && lastMessageAt > readAt;
            // Unread badge: messages from others after the person's read mark (capped at 99, as a badge shows).
            let unreadCount = 0;
            if (unread) {
                const later = await runQuery({
                    from: [{ collectionId: 'messages' }],
                    where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN', value: encodeValue(readAt || '0') } },
                    select: { fields: [{ fieldPath: 'senderUid' }] },
                    limit: 99,
                }, ROOM_PATH(ctx.orgId, d.id));
                unreadCount = Math.max(1, later.filter((m) => str(m.data.senderUid) !== ctx.uid).length);
            }
            const local = prefMap.get('room_' + d.id) ?? {};
            const muteUntil = str(local.muteUntil);
            // Ticks for my last message on the 60 most recent chats (keeps the list fast for very long inboxes).
            const lastStatus = str(d.data.lastSenderUid) === ctx.uid && lastMessageAt && index < 60
                ? await lastMessageStatus(ctx, d.id, membersOf(d), str(d.data.kind) !== 'group', lastMessageAt) : '';
            return {
                ...roomView(d.id, d.data),
                unread, unreadCount, lastStatus,
                muted: local.muted === true && (!muteUntil || Date.parse(muteUntil) > now),
                pinned: local.pinned === true,
            };
        })) };
    })],
    'POST /api/org/quick/chat/start': [orgRoute('chat.start', null, async (ctx) => {
        const kind = str(ctx.body.kind);
        const ids = [...new Set(Array.isArray(ctx.body.memberUids) ? ctx.body.memberUids.map(str) : [])];
        if (!['direct','group'].includes(kind)) throw new HttpError(400, 'Choose individual or group chat.');
        if (ids.includes(ctx.uid)) throw new HttpError(400, 'Select other members; your account is already included.');
        if (kind === 'direct' && ids.length !== 1) throw new HttpError(400, 'Choose exactly one colleague.');
        if (kind === 'group' && (ids.length < 1 || ids.length >= MAX_GROUP)) {
            throw new HttpError(400, 'Choose 1 to 49 other organization colleagues.');
        }
        if (!ids.every((id) => /^[A-Za-z0-9]{6,128}$/.test(id))) throw new HttpError(400, 'Invalid participant selection.');
        await verifiedPeople(ctx, [ctx.uid, ...ids]);
        const name = str(ctx.body.title).trim().slice(0, 90);
        if (kind === 'group' && name.length < 3) throw new HttpError(400, 'Enter a group name.');
        const linkedGroupId=kind==='group'?str(ctx.body.workGroupId):'';
        if(linkedGroupId){
            const group=await readWorkGroup(ctx,linkedGroupId);
            if(str(group.data.chatRoomId))throw new HttpError(409,'Work group already has a conversation. Open it instead.');
            if(str(group.data.automatic)&&str(group.data.ownerUid)!==ctx.uid)throw new HttpError(403,'Only the person whose reporting line forms this automatic team can open its group chat.');
            if(ids.some(uid=>!(Array.isArray(group.data.memberUids)&&group.data.memberUids.includes(uid))))throw new HttpError(403,'All chat participants must belong to the selected work group.');
        }
        const id = kind === 'direct' ? directId(ctx.uid, ids[0]) : 'g_' + randomId(14);
        const now = nowIso();
        const doc = {
            kind, title: kind === 'group' ? name : '', description: '',
            members: kind === 'group' ? [ctx.uid] : [ctx.uid, ...ids], pendingInvites: kind === 'group' ? ids : [], admins: [ctx.uid],
            createdBy: ctx.uid, createdAt: now, updatedAt: now,
            lastMessage: '', lastSenderUid: '', lastMessageId: '', lastMessageAt: '',
        };
        const path = ROOM_PATH(ctx.orgId, id);
        const created = await writeDoc(path, doc, { exists: false });
        const room = created ? await getDoc(path) : await checkedRoom(ctx, id);
        if (!room) throw new HttpError(503, 'Could not open this conversation.');
        if (created) {
            if(kind==='group'){
                const workGroupId=await fromChat(ctx,id,name,ids,linkedGroupId);
                await updateFields(path,{workGroupId});
            }
            await stamp(ctx, 'chat.conversation.start', id);
            await Promise.all([...new Set([...membersOf(room), ...(Array.isArray(room.data.pendingInvites) ? room.data.pendingInvites.map(str) : [])])].map((uid) => notify(ctx, 'chat.inbox', uid)));
        } else {
            // Reopening a previously hidden individual chat must be intentional.
            await deleteDoc(prefPath(ctx.uid, id));
        }
        return { room: roomView(id, (await getDoc(path))?.data || room.data) };
    })],
    'POST /api/org/quick/chat/group/update': [orgRoute('chat.group.update', null, async (ctx) => {
        const id = str(ctx.body.roomId);
        const room = await checkedRoom(ctx, id);
        const action = str(ctx.body.action);
        const isAdmin = Array.isArray(room.data.admins) && room.data.admins.map(str).includes(ctx.uid);
        // Group info (name and description) can be opened to every member by an administrator, as in WhatsApp.
        const infoOpen = str(room.data.infoPolicy) === 'all' && (action === 'rename' || action === 'describe');
        if (str(room.data.kind) !== 'group' || !(isAdmin || infoOpen)) {
            throw new HttpError(403, 'Only group administrators can edit this group.');
        }
        const original = membersOf(room);
        const admins = Array.isArray(room.data.admins) ? room.data.admins.map(str) : [ctx.uid];
        if (action === 'rename') {
            const title = str(ctx.body.title).trim();
            if (title.length < 3 || title.length > 90) throw new HttpError(400, 'Group name must be 3–90 characters.');
            await updateFields(ROOM_PATH(ctx.orgId, id), { title, updatedAt: nowIso() });
        } else if (action === 'describe') {
            const description = str(ctx.body.description).trim();
            if (description.length > 500) throw new HttpError(400, 'The group description can be up to 500 characters.');
            await updateFields(ROOM_PATH(ctx.orgId, id), { description, updatedAt: nowIso() });
        } else if (action === 'policy') {
            const sendPolicy = str(ctx.body.sendPolicy), infoPolicy = str(ctx.body.infoPolicy);
            if (!['all', 'admins'].includes(sendPolicy) || !['all', 'admins'].includes(infoPolicy)) throw new HttpError(400, 'Choose who can send messages and who can edit group info.');
            await updateFields(ROOM_PATH(ctx.orgId, id), { sendPolicy, infoPolicy, updatedAt: nowIso() });
        } else if (action === 'add') {
            const ids = [...new Set(Array.isArray(ctx.body.memberUids) ? ctx.body.memberUids.map(str) : [])];
            const pending = Array.isArray(room.data.pendingInvites) ? room.data.pendingInvites.map(str) : [];
            const fresh = ids.filter((uid) => !original.includes(uid) && !pending.includes(uid));
            if (!fresh.length || original.length + pending.length + fresh.length > MAX_GROUP) {
                throw new HttpError(400, 'Choose new colleagues; each group supports up to 50 participants and pending invitations.');
            }
            if (!ids.every((uid)=>/^[A-Za-z0-9]{6,128}$/.test(uid))) throw new HttpError(400, 'Invalid member.');
            await verifiedPeople(ctx, fresh);
            const saved = await writeDoc(ROOM_PATH(ctx.orgId, id), {
                ...room.data, pendingInvites: [...pending, ...fresh], updatedAt: nowIso()
            }, { updateTime: room.updateTime });
            if (!saved) throw new HttpError(409, 'Membership changed. Refresh and try again.');
            await Promise.all(fresh.map((uid) => notify(ctx, 'chat.inbox', uid)));
        } else if (action === 'remove') {
            const uid = str(ctx.body.memberUid);
            if (!original.includes(uid) || uid === str(room.data.createdBy)) {
                throw new HttpError(400, 'Choose a removable participant. The group creator must remain.');
            }
            const saved = await writeDoc(ROOM_PATH(ctx.orgId, id), {
                ...room.data, members: original.filter((member) => member !== uid),
                admins: admins.filter((admin) => admin !== uid), updatedAt: nowIso(),
            }, { updateTime: room.updateTime });
            if (!saved) throw new HttpError(409, 'Membership changed. Refresh and try again.');
        } else throw new HttpError(400, 'Choose a group action.');
        const updated = await getDoc(ROOM_PATH(ctx.orgId, id));
        if (!updated) throw new HttpError(404, 'Group not found.');
        await stamp(ctx, 'chat.group.' + action, id);
        await syncFromChat(ctx,updated);
        await notifyRoom(ctx, updated);
        // Removed members should immediately clear their inbox even though they
        // cannot subscribe or retrieve the group's contents anymore.
        for (const uid of original.filter((uid) => !membersOf(updated).includes(uid))) {
            await notify(ctx, 'chat.inbox', uid);
        }
        return { room: roomView(id, updated.data) };
    })],
    'POST /api/org/quick/chat/hide': [orgRoute('chat.hide', null, async (ctx) => {
        const id = str(ctx.body.roomId);
        await checkedRoom(ctx, id);
        await writeDoc(prefPath(ctx.uid, id), { hiddenAt: nowIso(), uid: ctx.uid });
        await notify(ctx, 'chat.inbox', ctx.uid);
        return { ok: true };
    })],
    // Live updates: a membership-checked long-poll that returns when the inbox or the open room changes.
    'POST /api/org/quick/chat/subscribe': [orgRoute('chat.subscribe', null, async (ctx) => waitForChanges(ctx))],
    'POST /api/org/quick/chat/unsubscribe': [orgRoute('chat.unsubscribe', null, async () => ({ ok: true }))],
};
