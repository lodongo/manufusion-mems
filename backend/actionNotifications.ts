import { getDoc, nowIso, randomId, str, updateFields, writeDoc, type Doc } from './core';
import { type OrgContext } from './guards';
import { checkedRoom, MESSAGE_ROOT, ROOM_PATH, notifyRoom } from './chatCommon';

/**
 * Reflect a committed action update in its source, never change action state here.
 * A notification failure is logged but cannot turn a successful progress write
 * into a false save failure, or create a second progress entry on retry.
 */
export async function publishActionUpdate(
    ctx:OrgContext, action:Doc, assigneeUid:string, activity:string, note:string,
):Promise<void> {
    const source=str(action.data.source)||(str(action.data.roomId)?'chat':'');
    const title=str(action.data.header)||str(action.data.title);
    const timestamp=nowIso();
    try {
        if(source==='chat'){
            const roomId=str(action.data.roomId);
            if(!roomId)return;
            const room=await checkedRoom(ctx,roomId);
            const id='actionupdate_'+randomId(12);
            const body='📋 Monitored Action: '+title+'\n'+activity+(note?'\nProgress: '+note:'');
            await writeDoc(MESSAGE_ROOT(ctx.orgId,roomId)+'/'+id,{
                senderUid:ctx.uid,text:body,systemUpdate:true,actionId:action.id,
                createdAt:timestamp,deletedForAll:false,attachment:{},reactions:{},
            },{exists:false});
            await updateFields(ROOM_PATH(ctx.orgId,roomId),{
                lastMessage:body.slice(0,100),lastSenderUid:ctx.uid,
                lastMessageId:id,lastMessageAt:timestamp,updatedAt:timestamp,
            });
            await notifyRoom(ctx,room,{event:'message'});
            await notifyRoom(ctx,room,{event:'action'});
            return;
        }
        if(source==='email'){
            const senderUid=str(action.data.requesterUid);
            const toUid=ctx.uid===senderUid?assigneeUid:senderUid;
            if(toUid===ctx.uid)return;
            const [sender,receiver]=await Promise.all([
                getDoc('users/'+ctx.uid),getDoc('users/'+toUid),
            ]);
            if(!sender||!receiver||str(sender.data.orgId)!==ctx.orgId||str(receiver.data.orgId)!==ctx.orgId)return;
            const display=[str(sender.data.firstName),str(sender.data.lastName)].filter(Boolean).join(' ')||str(sender.data.email);
            const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
            const excerpt=display+' — '+activity+(note?' · '+note:'');
            const html='<p><strong>Monitored Action: '+escape(title)+'</strong></p>'
                +'<p>'+escape(display)+' · '+escape(activity)+'</p>'
                +(note?'<p>Progress: '+escape(note)+'</p>':'')
                +'<p>This update has been recorded in My To-do.</p>';
            const id='actemail_'+randomId(13);
            const common={
                fromUid:ctx.uid,fromName:display,fromEmail:str(sender.data.email).toLowerCase(),
                to:[str(receiver.data.email).toLowerCase()],cc:[],bcc:[],
                subject:'Re: '+(str(action.data.mailSubject)||title),
                html,excerpt:excerpt.slice(0,260),attachments:[],priority:'normal',
                threadId:str(action.data.mailThreadId)||str(action.data.sourceId),
                inReplyTo:str(action.data.sourceId),actionId:action.id,
                sentAt:timestamp,updatedAt:timestamp,starred:false,flagged:false,focus:true,category:'Action',
                allowReply:true,allowReplyAll:true,allowDelete:true,
            };
            const root='organizations/'+ctx.orgId+'/mailboxes/';
            await writeDoc(root+ctx.uid+'/items/'+id+'_sent',{...common,folder:'sent',read:true},{exists:false});
            await writeDoc(root+toUid+'/items/'+id,{...common,folder:'inbox',read:false},{exists:false});
            return;
        }
        if(source==='calendar'){
            const eventId=str(action.data.sourceId);
            if(!/^ev_[A-Za-z0-9_-]{12,60}$/.test(eventId))return;
            await writeDoc('organizations/'+ctx.orgId+'/calendar_events/'+eventId+'/activity/act_'+randomId(12),{
                actionId:action.id,actionTitle:title,activity,note,
                actorUid:ctx.uid,assigneeUid,createdAt:timestamp,
            },{exists:false});
        }
    }catch(error){
        console.error('Action saved; source update could not be delivered',
            error instanceof Error?error.message:'Unknown notification error');
    }
}
