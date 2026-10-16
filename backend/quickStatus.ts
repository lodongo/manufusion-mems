import { getDoc, listDocs, str } from './core';
import { orgRoute } from './guards';
import { CHAT_ROOT, ROOM_PATH, membersOf } from './chatCommon';

const todoPath=(uid:string)=>'users/'+uid+'/quick_todos';
const actionsRoot=(orgId:string)=>'organizations/'+orgId+'/chat_actions';

/** Counts distinct attention items without exposing message or colleague content. */
export const quickStatusRoutes={
    'POST /api/org/quick/status':[orgRoute('quick.status',null,async(ctx)=>{
        const today=new Date().toISOString().slice(0,10);
        const [todos,rooms,allActions]=await Promise.all([
            listDocs(todoPath(ctx.uid)),listDocs(CHAT_ROOT(ctx.orgId)),listDocs(actionsRoot(ctx.orgId)),
        ]);
        const overduePersonal=todos.filter(t=>
            !['closed','canceled','done'].includes(str(t.data.status))
            && /^\d{4}-\d{2}-\d{2}$/.test(str(t.data.deadline))
            && str(t.data.deadline)<today).length;
        const myRooms=rooms.filter(room=>{
            const joined=membersOf(room).includes(ctx.uid);
            const invited=Array.isArray(room.data.pendingInvites)&&room.data.pendingInvites.includes(ctx.uid);
            return joined||invited;
        });
        const roomIds=new Set(myRooms.filter(r=>membersOf(r).includes(ctx.uid)).map(r=>r.id));
        const [roomChecks,assigned]=await Promise.all([
            Promise.all(myRooms.map(async room=>{
                const invited=Array.isArray(room.data.pendingInvites)&&room.data.pendingInvites.includes(ctx.uid);
                if(invited)return 1;
                if(str(room.data.lastSenderUid)===ctx.uid||!str(room.data.lastMessageAt))return 0;
                const read=await getDoc(ROOM_PATH(ctx.orgId,room.id)+'/read_marks/'+ctx.uid);
                return str(room.data.lastMessageAt)>str(read?.data.readAt)?1:0;
            })),
            Promise.all(allActions.filter(a=>a.data.canceled!==true
                &&(!str(a.data.roomId)||roomIds.has(str(a.data.roomId)))
                &&(str(a.data.requesterUid)===ctx.uid||
                    (Array.isArray(a.data.recipientUids)&&a.data.recipientUids.includes(ctx.uid))))
                .slice(0,220).map(async a=>{
                    const mine=await getDoc(actionsRoot(ctx.orgId)+'/'+a.id+'/assignments/'+ctx.uid);
                    const recipient=Array.isArray(a.data.recipientUids)&&a.data.recipientUids.includes(ctx.uid);
                    const deadline=str(a.data.deadline);
                    const unacknowledged=mine && str(mine.data.decision)!=='declined'
                        && str(mine.data.status)!=='canceled'
                        && !str(mine.data.acknowledgedAt);
                    const needsResponse=recipient && !!mine &&
                        ['pending','review'].includes(str(mine.data.decision));
                    const overdue=recipient && !!unacknowledged &&
                        /^\d{4}-\d{2}-\d{2}$/.test(deadline)&&deadline<today;
                    if(recipient)return {new:needsResponse?1:0,overdue:overdue?1:0};
                    const assignments=await listDocs(actionsRoot(ctx.orgId)+'/'+a.id+'/assignments');
                    const review=assignments.some(s=>str(s.data.status)==='closed'&&!str(s.data.acknowledgedAt));
                    return {new:review?1:0,overdue:0};
                })),
        ]);
        const unreadChats=roomChecks.reduce((s,n)=>s+n,0);
        const newMonitored=assigned.reduce((s,a)=>s+a.new,0);
        const overdueMonitored=assigned.reduce((s,a)=>s+a.overdue,0);
        const overdue=overduePersonal+overdueMonitored;
        return {total:unreadChats+newMonitored+overdue,unreadChats,newMonitored,
            overdue,overduePersonal,overdueMonitored};
    })],
};
