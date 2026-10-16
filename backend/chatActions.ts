import { HttpError, createDoc, getDoc, listDocs, nowIso, randomId, str, updateFields, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { audit } from './audit';
import { checkedRoom, membersOf, notifyRoom, ID_RE, MESSAGE_ROOT, ROOM_PATH } from './chatCommon';
import { publishActionUpdate } from './actionNotifications';
import { actionPhotoUrl, validateActionPhoto } from './actionPhotos';

const ROOT=(orgId:string)=>'organizations/'+orgId+'/chat_actions';
const actionPath=(orgId:string,id:string)=>ROOT(orgId)+'/'+id;
const assignments=(orgId:string,id:string)=>actionPath(orgId,id)+'/assignments';
const comments=(orgId:string,id:string)=>actionPath(orgId,id)+'/comments';
const now=()=>nowIso();
const idOkay=(id:string)=>ID_RE.test(id);
const role=(ctx:OrgContext, task:{requesterUid:string;recipientUids:string[]}) =>
  task.requesterUid===ctx.uid?'requester':task.recipientUids.includes(ctx.uid)?'recipient':'observer';
function ids(raw:unknown):string[] {
    return [...new Set(Array.isArray(raw)?raw.map(str).filter(Boolean):[])];
}
async function target(ctx:OrgContext,id:string) {
    if(!idOkay(id))throw new HttpError(400,'Choose a chat action.');
    const doc=await getDoc(actionPath(ctx.orgId,id));
    if(!doc)throw new HttpError(404,'Chat action not found.');
    const room=await checkedRoom(ctx,str(doc.data.roomId));
    if(!membersOf(room).includes(ctx.uid))throw new HttpError(403,'You do not belong to this conversation.');
    return {doc,room};
}
async function actionView(ctx:OrgContext,doc:Awaited<ReturnType<typeof getDoc>>) {
    if(!doc)throw new HttpError(404,'Action not found.');
    const [people,history]=await Promise.all([
        listDocs(assignments(ctx.orgId,doc.id)),listDocs(comments(ctx.orgId,doc.id))
    ]);
    return { id:doc.id, ...doc.data, photoUrl:await actionPhotoUrl(ctx,doc.data.photoPath),assignments:people.map(d=>({uid:d.id,...d.data})), 
        comments:history.sort((a,b)=>str(a.data.createdAt).localeCompare(str(b.data.createdAt)))
        .slice(-120).map(d=>({id:d.id,...d.data})) };
}
async function event(ctx:OrgContext,name:string,id:string,note='') {
    await audit([{category:'interaction',action:'chat.action.'+name,actor:ctx.actor,meta:ctx.meta,
        orgId:ctx.orgId,target:{type:'chat_action',id}}]);
    if(name==='request')return;
    const action=await getDoc(actionPath(ctx.orgId,id));
    if(action)await publishActionUpdate(ctx,action,ctx.uid,name,note);
}
async function updated(ctx:OrgContext,roomId:string) {
    const room=await checkedRoom(ctx,roomId);
    await notifyRoom(ctx,room,{event:'action'});
}
export const chatActionRoutes={
    'POST /api/org/quick/chat/action/create':[orgRoute('chat.action.create',null,async ctx=>{
        const roomId=str(ctx.body.roomId),room=await checkedRoom(ctx,roomId);
        const assignees=ids(ctx.body.recipientUids);
        if(!assignees.length||assignees.length>35||assignees.includes(ctx.uid)
            ||assignees.some(uid=>!membersOf(room).includes(uid))) {
            throw new HttpError(400,'Assign to 1–35 other active conversation participants.');
        }
        const title=str(ctx.body.title).trim().slice(0,180);
        const description=str(ctx.body.description).trim().slice(0,2400);
        const deadline=str(ctx.body.deadline);
        if(title.length<3)throw new HttpError(400,'Enter an action.');
        if(description.length<3)throw new HttpError(400,'Describe the action in at least 3 characters.');
        if(deadline&&(!/^\d{4}-\d{2}-\d{2}$/.test(deadline)||Number.isNaN(Date.parse(deadline))))throw new HttpError(400,'Choose a valid deadline.');
        const id='ca_'+randomId(13),stamp=now();
        const path=actionPath(ctx.orgId,id);
        const saved=await writeDoc(path,{roomId,requesterUid:ctx.uid,recipientUids:assignees,
            title,description,header:title,body:description,source:'chat',sourceId:roomId,
            photoPath:validateActionPhoto(ctx,ctx.body.photoPath),
            deadline,createdAt:stamp,updatedAt:stamp,canceled:false,
            kind:'chat_assignment'}, {exists:false});
        if(!saved)throw new HttpError(409,'Action could not be created.');
        for(const uid of assignees) {
            await writeDoc(assignments(ctx.orgId,id)+'/'+uid,{
                decision:'pending',status:'open',reviewNote:'',progressNotes:[],
                updatedAt:stamp,acceptedAt:'',closedAt:'',acknowledgedAt:'',acknowledgementNote:''
            },{exists:false});
        }
        await writeDoc(MESSAGE_ROOT(ctx.orgId,roomId)+'/event_'+id,{
            senderUid:ctx.uid,text:'',eventKind:'action',referenceId:id,
            createdAt:stamp,deletedForAll:false,attachment:{},reactions:{}
        },{exists:false});
        await updateFields(ROOM_PATH(ctx.orgId,roomId),{
            lastMessage:'📋 Monitored Action: '+title.slice(0,85),
            lastSenderUid:ctx.uid,lastMessageId:'event_'+id,lastMessageAt:stamp,updatedAt:stamp
        });
        await event(ctx,'request',id);
        await updated(ctx,roomId);
        return {action:await actionView(ctx,await getDoc(path))};
    })],
    'POST /api/org/quick/chat/action/list':[orgRoute('chat.action.list',null,async ctx=>{
        const roomId=str(ctx.body.roomId);
        if(roomId)await checkedRoom(ctx,roomId);
        const all=await listDocs(ROOT(ctx.orgId));
        const allowed=all.filter(d=>!roomId||str(d.data.roomId)===roomId)
            .filter(d=>d.data.kind==='chat_assignment');
        const rooms=new Map<string,boolean>();
        const visible=[];
        for(const item of allowed.sort((a,b)=>str(b.data.createdAt).localeCompare(str(a.data.createdAt))).slice(0,175)){
            const conversation=str(item.data.roomId);
            if(!rooms.has(conversation)){
                try {await checkedRoom(ctx,conversation);rooms.set(conversation,true);}
                catch {rooms.set(conversation,false);}
            }
            if(rooms.get(conversation))visible.push(await actionView(ctx,item));
        }
        return {actions:visible};
    })],
    'POST /api/org/quick/chat/action/respond':[orgRoute('chat.action.respond',null,async ctx=>{
        const id=str(ctx.body.actionId),decision=str(ctx.body.decision);
        const {doc}=await target(ctx,id);
        if(doc.data.canceled===true)throw new HttpError(409,'This request is canceled.');
        if(!ids(doc.data.recipientUids).includes(ctx.uid))throw new HttpError(403,'Only the assigned person can respond.');
        if(!['accept','review','decline'].includes(decision))throw new HttpError(400,'Choose Accept, Request review, or Decline.');
        const path=assignments(ctx.orgId,id)+'/'+ctx.uid;
        const previous=await getDoc(path);
        if(!previous||str(previous.data.decision)!=='pending')throw new HttpError(409,'This request has already been answered.');
        const note=str(ctx.body.note).trim().slice(0,1800);
        if(decision!=='accept'&&note.length<5)throw new HttpError(400,'Explain what information is needed or why you are declining.');
        const next=decision==='accept'?'accepted':decision==='review'?'review':'declined';
        const saved=await writeDoc(path,{...previous.data,decision:next,reviewNote:note,
            updatedAt:now(),acceptedAt:decision==='accept'?now():''
        },{updateTime:previous.updateTime});
        if(!saved)throw new HttpError(409,'Response changed. Refresh and retry.');
        await event(ctx,decision==='accept'?'Accepted':decision==='review'?'Review requested':'Declined',id,note);await updated(ctx,str(doc.data.roomId));
        return {ok:true};
    })],
    'POST /api/org/quick/chat/action/revise':[orgRoute('chat.action.revise',null,async ctx=>{
        const id=str(ctx.body.actionId);
        const {doc}=await target(ctx,id);
        if(str(doc.data.requesterUid)!==ctx.uid)throw new HttpError(403,'Only the requester can revise the request.');
        if(doc.data.canceled===true)throw new HttpError(409,'This request is canceled.');
        const uid=str(ctx.body.uid),existing=await getDoc(assignments(ctx.orgId,id)+'/'+uid);
        if(!existing||str(existing.data.decision)!=='review')throw new HttpError(409,'This person has not requested a review.');
        const title=str(ctx.body.title).trim().slice(0,180)||str(doc.data.title);
        const description=str(ctx.body.description).trim().slice(0,2400);
        const deadline=str(ctx.body.deadline)||str(doc.data.deadline);
        if(deadline&&(!/^\d{4}-\d{2}-\d{2}$/.test(deadline)||Number.isNaN(Date.parse(deadline))))throw new HttpError(400,'Invalid deadline.');
        await updateFields(actionPath(ctx.orgId,id),{title,description,header:title,body:description,deadline,updatedAt:now()});
        await updateFields(assignments(ctx.orgId,id)+'/'+uid,{decision:'pending',reviewNote:'',updatedAt:now()});
        await event(ctx,'revised',id);await updated(ctx,str(doc.data.roomId));
        return {ok:true};
    })],
    'POST /api/org/quick/chat/action/progress':[orgRoute('chat.action.progress',null,async ctx=>{
        const id=str(ctx.body.actionId);
        const {doc}=await target(ctx,id);
        if(doc.data.canceled===true)throw new HttpError(409,'Action was canceled by requester.');
        const path=assignments(ctx.orgId,id)+'/'+ctx.uid;
        const current=await getDoc(path);
        if(!current||str(current.data.decision)!=='accepted')throw new HttpError(403,'Only an assignee who accepted may update progress.');
        if(str(current.data.acknowledgedAt))throw new HttpError(409,'The requester acknowledged closure. This assignment is final.');
        const status=str(ctx.body.status);
        if(!['open','closed','canceled'].includes(status))throw new HttpError(400,'Choose Open, Closed, or Canceled.');
        const note=str(ctx.body.note).trim().slice(0,1400);
        if(status==='canceled'&&note.length<5)throw new HttpError(400,'Give a cancellation reason.');
        const old=Array.isArray(current.data.progressNotes)?current.data.progressNotes:[];
        const stamp=now();
        const saved=await writeDoc(path,{
            ...current.data,status,updatedAt:stamp,
            closedAt:status==='closed'?stamp:'',
            acknowledgedAt:'',acknowledgementNote:'',
            progressNotes:note?[...old.slice(-99),{note,at:stamp,by:ctx.uid}]:old
        },{updateTime:current.updateTime});
        if(!saved)throw new HttpError(409,'Progress changed. Refresh and retry.');
        await event(ctx,status==='closed'?'Closure submitted':status==='canceled'?'Canceled':'Progress updated',id,note);await updated(ctx,str(doc.data.roomId));
        return {ok:true};
    })],
    'POST /api/org/quick/chat/action/acknowledge':[orgRoute('chat.action.acknowledge',null,async ctx=>{
        const id=str(ctx.body.actionId),uid=str(ctx.body.uid),decision=str(ctx.body.decision);
        const {doc}=await target(ctx,id);
        if(str(doc.data.requesterUid)!==ctx.uid)throw new HttpError(403,'Only the requester may acknowledge closure.');
        if(!['acknowledge','return'].includes(decision))throw new HttpError(400,'Choose acknowledge or request further work.');
        if(doc.data.canceled===true)throw new HttpError(409,'This request was canceled.');
        const path=assignments(ctx.orgId,id)+'/'+uid;
        const current=await getDoc(path);
        if(!current||str(current.data.decision)!=='accepted'||str(current.data.status)!=='closed'
            ||str(current.data.acknowledgedAt))throw new HttpError(409,'This assignment is not awaiting confirmation.');
        const note=str(ctx.body.note).trim().slice(0,1400);
        if(decision==='return'&&note.length<5)throw new HttpError(400,'Explain what additional work is required.');
        const stamp=now(),old=Array.isArray(current.data.progressNotes)?current.data.progressNotes:[];
        const saved=await writeDoc(path,{
            ...current.data,
            status:decision==='return'?'open':'closed',
            closedAt:decision==='return'?'':str(current.data.closedAt),
            acknowledgedAt:decision==='acknowledge'?stamp:'',
            acknowledgementNote:note,
            updatedAt:stamp,
            progressNotes:note?[...old.slice(-99),{note,at:stamp,by:ctx.uid,type:decision}]:old,
        },{updateTime:current.updateTime});
        if(!saved)throw new HttpError(409,'The assignment changed. Refresh and try again.');
        await event(ctx,decision==='acknowledge'?'Closure acknowledged':'Returned for more work',id,note);await updated(ctx,str(doc.data.roomId));
        return {ok:true,acknowledged:decision==='acknowledge'};
    })],
    'POST /api/org/quick/chat/action/comment':[orgRoute('chat.action.comment',null,async ctx=>{
        const id=str(ctx.body.actionId);
        const {doc}=await target(ctx,id);
        const comment=str(ctx.body.text).trim().slice(0,1400);
        if(!comment)throw new HttpError(400,'Enter a progress comment.');
        const data={by:ctx.uid,text:comment,createdAt:now()};
        await createDoc(comments(ctx.orgId,id),data);
        await event(ctx,'comment',id);await updated(ctx,str(doc.data.roomId));
        return {ok:true};
    })],
    'POST /api/org/quick/chat/action/cancel':[orgRoute('chat.action.cancel',null,async ctx=>{
        const id=str(ctx.body.actionId),reason=str(ctx.body.reason).trim().slice(0,1400);
        const {doc}=await target(ctx,id);
        if(str(doc.data.requesterUid)!==ctx.uid)throw new HttpError(403,'Only the requester can cancel the request.');
        if(reason.length<5)throw new HttpError(400,'A cancellation reason is required.');
        await updateFields(actionPath(ctx.orgId,id),{canceled:true,cancelReason:reason,updatedAt:now()});
        await event(ctx,'Canceled',id,reason);await updated(ctx,str(doc.data.roomId));
        return {ok:true};
    })]
};
