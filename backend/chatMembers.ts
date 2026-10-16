import { HttpError, getDoc, listDocs, nowIso, str, writeDoc } from './core';
import { orgRoute } from './guards';
import { audit } from './audit';
import { syncFromChat } from './workGroups';
import { CHAT_ROOT, ROOM_PATH, checkedRoom, membersOf, notify, notifyRoom, verifiedPeople, ID_RE, MAX_GROUP } from './chatCommon';

const invites = (data: Record<string, unknown>): string[] =>
    (Array.isArray(data.pendingInvites) ? data.pendingInvites : []).map(str).filter(Boolean);
const admins = (data: Record<string, unknown>): string[] =>
    (Array.isArray(data.admins) ? data.admins : []).map(str).filter(Boolean);
const settingsPath = (uid: string) => 'users/' + uid + '/chat_prefs/settings';
const roomSettingsPath = (uid: string, id: string) => 'users/' + uid + '/chat_prefs/room_' + id;
const COLORS = ['default','ocean','forest','rose','amber','slate','violet'] as const;
async function commitRoom(path: string, before: Awaited<ReturnType<typeof getDoc>>, updates: Record<string, any>) {
    if (!before) throw new HttpError(404,'Conversation not found.');
    const success = await writeDoc(path, { ...before.data, ...updates, updatedAt: nowIso() }, { updateTime: before.updateTime });
    if (!success) throw new HttpError(409,'Group membership changed. Refresh and try again.');
}
const log = (ctx: {actor:any;meta:any;orgId:string}, action:string, id:string) => audit([{
    category:'interaction', action, actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,
    target:{type:'chat_room',id},details:'Organization group membership/settings'
}]);
export const chatMemberRoutes = {
    'POST /api/org/quick/chat/invitations': [orgRoute('chat.invitations', null, async ctx => {
        const rooms=await listDocs(CHAT_ROOT(ctx.orgId));
        return { invitations: rooms.filter(r=>str(r.data.kind)==='group'&&invites(r.data).includes(ctx.uid))
            .map(r=>({id:r.id,title:str(r.data.title),createdBy:str(r.data.createdBy),createdAt:str(r.data.createdAt),count:membersOf(r).length})) };
    })],
    'POST /api/org/quick/chat/invitation/respond': [orgRoute('chat.invitation.respond', null, async ctx => {
        const id=str(ctx.body.roomId), decision=str(ctx.body.decision);
        if(!ID_RE.test(id)||!['accept','decline'].includes(decision)) throw new HttpError(400,'Choose accept or decline.');
        const room=await getDoc(ROOM_PATH(ctx.orgId,id));
        if(!room||str(room.data.kind)!=='group'||!invites(room.data).includes(ctx.uid)) throw new HttpError(404,'Invitation not available.');
        await verifiedPeople(ctx,[ctx.uid]);
        const pending=invites(room.data).filter(uid=>uid!==ctx.uid);
        const members=membersOf(room);
        if(decision==='accept'&&members.length>=MAX_GROUP) throw new HttpError(409,'This group is full.');
        await commitRoom(ROOM_PATH(ctx.orgId,id),room,{
            pendingInvites:pending,
            members:decision==='accept'?[...new Set([...members,ctx.uid])]:members
        });
        const updated=await getDoc(ROOM_PATH(ctx.orgId,id));
        if(updated){await syncFromChat(ctx,updated);await notifyRoom(ctx,updated);}
        await notify(ctx,'chat.inbox',ctx.uid);
        await log(ctx,'chat.invite.'+decision,id);
        return {ok:true,joined:decision==='accept'};
    })],
    'POST /api/org/quick/chat/group/member': [orgRoute('chat.group.member', null, async ctx => {
        const id=str(ctx.body.roomId),action=str(ctx.body.action),uid=str(ctx.body.uid);
        const room=await checkedRoom(ctx,id);
        if(str(room.data.kind)!=='group') throw new HttpError(400,'This is not a group chat.');
        const members=membersOf(room), managers=admins(room.data),creator=str(room.data.createdBy);
        let nextMembers=members, nextAdmins=managers, nextInvites=invites(room.data);
        if(action==='leave') {
            if(creator===ctx.uid) throw new HttpError(409,'The group creator must remain administrator. Transfer ownership is not enabled.');
            nextMembers=members.filter(x=>x!==ctx.uid);
            nextAdmins=managers.filter(x=>x!==ctx.uid);
        } else {
            if(!managers.includes(ctx.uid)) throw new HttpError(403,'Only group administrators can manage members.');
            if(action==='promote'||action==='demote') {
                if(!members.includes(uid)) throw new HttpError(400,'Select a group participant.');
                if(uid===creator&&action==='demote') throw new HttpError(403,'The group creator must remain an administrator.');
                nextAdmins=action==='promote'?[...new Set([...managers,uid])]:managers.filter(x=>x!==uid);
                if(!nextAdmins.includes(creator)) nextAdmins.push(creator);
            } else if(action==='revoke') {
                if(!nextInvites.includes(uid)) throw new HttpError(404,'Pending invitation not found.');
                nextInvites=nextInvites.filter(x=>x!==uid);
            } else throw new HttpError(400,'Choose a group-member action.');
        }
        await commitRoom(ROOM_PATH(ctx.orgId,id),room,{
            members:nextMembers,admins:nextAdmins,pendingInvites:nextInvites
        });
        const updated=await getDoc(ROOM_PATH(ctx.orgId,id));
        if(updated){await syncFromChat(ctx,updated);await notifyRoom(ctx,updated);}
        if(action==='leave') await notify(ctx,'chat.inbox',ctx.uid);
        if(action==='revoke') await notify(ctx,'chat.inbox',uid);
        await log(ctx,'chat.group.'+action,id);
        return {ok:true};
    })],
    'POST /api/org/quick/chat/preferences': [orgRoute('chat.preferences', null, async ctx => {
        const roomId=str(ctx.body.roomId);
        if(roomId) await checkedRoom(ctx,roomId);
        const [global,local]=await Promise.all([
            getDoc(settingsPath(ctx.uid)),roomId?getDoc(roomSettingsPath(ctx.uid,roomId)):Promise.resolve(null)
        ]);
        return {
            muteAll:global?.data.muteAll===true,
            defaultTheme:COLORS.includes(str(global?.data.defaultTheme) as typeof COLORS[number])?str(global?.data.defaultTheme):'default',
            muted:local?.data.muted===true,
            theme:COLORS.includes(str(local?.data.theme) as typeof COLORS[number])?str(local?.data.theme):'default'
        };
    })],
    'POST /api/org/quick/chat/preferences/save': [orgRoute('chat.preferences.save', null, async ctx => {
        const roomId=str(ctx.body.roomId),mode=str(ctx.body.mode);
        if(mode==='mute_all') {
            await writeDoc(settingsPath(ctx.uid),{
                muteAll:ctx.body.muteAll===true,updatedAt:nowIso()
            });
        } else {
            await checkedRoom(ctx,roomId);
            if(!ID_RE.test(roomId)) throw new HttpError(400,'Invalid conversation.');
            const old=await getDoc(roomSettingsPath(ctx.uid,roomId));
            if(mode==='mute') await writeDoc(roomSettingsPath(ctx.uid,roomId),{
                ...old?.data,muted:ctx.body.muted===true,updatedAt:nowIso()
            });
            else if(mode==='theme') {
                const theme=str(ctx.body.theme);
                if(!COLORS.includes(theme as typeof COLORS[number])) throw new HttpError(400,'Choose a chat theme.');
                await writeDoc(roomSettingsPath(ctx.uid,roomId),{
                    ...old?.data,theme,updatedAt:nowIso()
                });
            } else throw new HttpError(400,'Choose a preference.');
        }
        await log(ctx,'chat.preferences.'+mode,roomId||ctx.uid);
        return {ok:true};
    })]
};
