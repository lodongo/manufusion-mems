import { HttpError, getDoc, listDocs, nowIso, randomId, str, writeDoc, updateFields, isObj, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { verifiedPeople, checkedRoom, membersOf } from './chatCommon';
import { audit } from './audit';
import { publishActionUpdate } from './actionNotifications';
import { actionPhotoUrl, validateActionPhoto } from './actionPhotos';

const ROOT=(orgId:string)=>'organizations/'+orgId+'/chat_actions';
const actionPath=(orgId:string,id:string)=>ROOT(orgId)+'/'+id;
const assignees=(orgId:string,id:string)=>actionPath(orgId,id)+'/assignments';
const allowedId=/^[a-zA-Z0-9_-]{8,100}$/;
const toIds=(v:unknown)=>[...new Set(Array.isArray(v)?v.map(str).filter(Boolean):[])];
const today=()=>nowIso();
async function record(ctx:OrgContext,action:string,id:string){
    await audit([{category:'interaction',action:'actions.'+action,actor:ctx.actor,
        meta:ctx.meta,orgId:ctx.orgId,target:{type:'monitored_action',id}}]);
}
export async function createMonitoredAction(ctx:OrgContext,params:{
    source:'email'|'calendar';sourceId:string;title:string;description:string;
    deadline:string;recipientUids:string[];threadId?:string;subject?:string;referenceId?:string;photoPath?:string
}){
    const ids=[...new Set(params.recipientUids)];
    if(!ids.length||ids.length>35||ids.some(uid=>!/^[A-Za-z0-9_-]{6,128}$/.test(uid)))throw new HttpError(400,'Choose 1–35 active colleagues for the action.');
    await verifiedPeople(ctx,[ctx.uid,...ids]);
    const title=params.title.trim().slice(0,180);
    const description=params.description.trim().slice(0,2400);
    const deadline=params.deadline;
    if(title.length<3)throw new HttpError(400,'Enter an action title of at least 3 characters.');
    if(description.length<3)throw new HttpError(400,'Describe what must be done in at least 3 characters.');
    if(deadline&&!/^\d{4}-\d{2}-\d{2}$/.test(deadline))throw new HttpError(400,'Choose a valid action deadline.');
    const id='ha_'+randomId(14),now=today();
    await writeDoc(actionPath(ctx.orgId,id),{
        kind:'monitored_action',source:params.source,sourceId:params.sourceId,
        header:title,body:description,
        requesterUid:ctx.uid,recipientUids:ids,title,description,deadline,
        photoPath:validateActionPhoto(ctx,params.photoPath),
        mailThreadId:params.threadId||'',mailSubject:params.subject||'',
        referenceId:params.referenceId||'',roomId:'',
        createdAt:now,updatedAt:now,canceled:false,
    },{exists:false});
    for(const uid of ids){
        await writeDoc(assignees(ctx.orgId,id)+'/'+uid,{
            decision:'pending',status:'open',reviewNote:'',progressNotes:[],updatedAt:now,
            acceptedAt:'',closedAt:'',acknowledgedAt:'',acknowledgementNote:'',
        },{exists:false});
    }
    await record(ctx,'create',id);
    return id;
}
async function target(ctx:OrgContext,id:string){
    if(!allowedId.test(id))throw new HttpError(400,'Choose an action.');
    const doc=await getDoc(actionPath(ctx.orgId,id));
    if(!doc)throw new HttpError(404,'Action not found.');
    if(str(doc.data.source)==='chat'||str(doc.data.roomId)){
        const room=await checkedRoom(ctx,str(doc.data.roomId));
        if(!membersOf(room).includes(ctx.uid))throw new HttpError(403,'You cannot view this Chat action.');
    }
    const ids=toIds(doc.data.recipientUids);
    if(str(doc.data.requesterUid)!==ctx.uid&&!ids.includes(ctx.uid))throw new HttpError(403,'This action is not yours.');
    return {doc,ids};
}
async function view(ctx:OrgContext,d:Doc){
    const a=await listDocs(assignees(ctx.orgId,d.id));
    return {id:d.id,...d.data,header:str(d.data.header)||str(d.data.title),body:str(d.data.body)||str(d.data.description),source:str(d.data.source)||'chat',photoUrl:await actionPhotoUrl(ctx,d.data.photoPath),
        assignments:await Promise.all(a.map(async row=>({uid:row.id,...row.data,
            progressNotes:await Promise.all((Array.isArray(row.data.progressNotes)?row.data.progressNotes:[]).filter(isObj).map(async x=>({...x,photoUrl:await actionPhotoUrl(ctx,x.photoPath)})))
        })))};
}
async function replyByEmail(ctx:OrgContext,doc:Doc,assigneeUid:string,activity:string,note:string){
    if(str(doc.data.source)!=='email')return;
    const requester=str(doc.data.requesterUid);
    const destUid=ctx.uid===requester?assigneeUid:requester;
    if(destUid===ctx.uid)return;
    const [from,to]=await Promise.all([getDoc('users/'+ctx.uid),getDoc('users/'+destUid)]);
    if(!from||!to||str(from.data.orgId)!==ctx.orgId||str(to.data.orgId)!==ctx.orgId)return;
    const subject='Re: '+(str(doc.data.mailSubject)||str(doc.data.title));
    const escaped=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const actor=[str(from.data.firstName),str(from.data.lastName)].filter(Boolean).join(' ')||str(from.data.email);
    const excerpt=actor+' — '+activity+(note?' · '+note:'');
    const message='<p><strong>Monitored Action: '+escaped(str(doc.data.title))+'</strong></p><p>'+escaped(excerpt)+'</p>'
        +'<p>Status update recorded in MEMS My To-do and the originating Email conversation.</p>';
    const at=today(),id='au_'+randomId(14);
    const common={
        fromUid:ctx.uid,fromName:actor,fromEmail:str(from.data.email),
        to:[str(to.data.email).toLowerCase()],cc:[],bcc:[],subject,
        html:message,excerpt:excerpt.slice(0,250),attachments:[],priority:'normal',
        threadId:str(doc.data.mailThreadId)||str(doc.data.sourceId),inReplyTo:str(doc.data.sourceId),
        actionId:doc.id,sentAt:at,updatedAt:at,starred:false,flagged:false,focus:true,category:'Action',
    };
    const base='organizations/'+ctx.orgId+'/mailboxes/';
    await writeDoc(base+ctx.uid+'/items/'+id+'_sent',{...common,folder:'sent',read:true},{exists:false});
    await writeDoc(base+destUid+'/items/'+id,{...common,folder:'inbox',read:false},{exists:false});
}
export const actionHubRoutes={
    'POST /api/org/actions/calendar':[orgRoute('actions.calendar',null,async ctx=>{
        const [docs,personal]=await Promise.all([
            listDocs(ROOT(ctx.orgId)),
            listDocs('users/'+ctx.uid+'/quick_todos'),
        ]);
        const markers:Array<{id:string;actionId:string;title:string;description:string;date:string;kind:string;status:string;source:string;roomId:string}>=[];
        const mark=(a:{id:string;title:string;description:string;source:string;roomId:string;status:string;deadline:string;closedAt:string})=>{
            const add=(date:string,kind:string)=>{
                if(/^\d{4}-\d{2}-\d{2}$/.test(date))markers.push({
                    id:a.id+'_'+kind,actionId:a.id,title:a.title,description:a.description,
                    date,kind,status:a.status,source:a.source,roomId:a.roomId,
                });
            };
            add(a.deadline,'due');
            const completedDate=a.closedAt.slice(0,10);
            if(completedDate)add(completedDate,'closed');
        };
        for(const d of docs.slice(0,450)){
            if(d.data.canceled===true)continue;
            const requester=str(d.data.requesterUid)===ctx.uid;
            const assignee=toIds(d.data.recipientUids).includes(ctx.uid);
            if(!requester&&!assignee)continue;
            const roomId=str(d.data.roomId);
            if(roomId){
                try{await checkedRoom(ctx,roomId);}catch{continue;}
            }
            const rows=await listDocs(assignees(ctx.orgId,d.id));
            const own=rows.find(r=>r.id===ctx.uid);
            if(!requester && str(own?.data.decision)!=='accepted')continue;
            const relevant=assignee?own?.data:null;
            const done=requester && !assignee && rows.length>0
                ?rows.every(r=>str(r.data.acknowledgedAt)||str(r.data.status)==='canceled'||str(r.data.decision)==='declined')
                :!!str(relevant?.acknowledgedAt);
            const closed=requester&&!assignee
                ?(done?rows.map(r=>str(r.data.acknowledgedAt)).filter(Boolean).sort().at(-1)||'':'')
                :str(relevant?.acknowledgedAt);
            mark({id:d.id,title:str(d.data.header)||str(d.data.title),description:str(d.data.body)||str(d.data.description),
                source:str(d.data.source)||'chat',roomId,
                status:done?'closed':str(relevant?.status)==='closed'?'pending_acknowledgement':'open',
                deadline:str(d.data.deadline),closedAt:closed});
        }
        for(const t of personal.slice(0,450)){
            if(str(t.data.orgId)!==ctx.orgId)continue;
            mark({id:t.id,title:str(t.data.header)||str(t.data.action),description:str(t.data.body)||str(t.data.description),
                source:'todo',roomId:'',status:str(t.data.status)||'open',
                deadline:str(t.data.deadline),closedAt:str(t.data.closedAt)});
        }
        return {items:markers.sort((a,b)=>a.date.localeCompare(b.date)).slice(-650)};
    })],
    'POST /api/org/actions/list':[orgRoute('actions.list',null,async ctx=>{
        const docs=(await listDocs(ROOT(ctx.orgId))).filter(d=>toIds(d.data.recipientUids).includes(ctx.uid) && d.data.canceled!==true);
        const visible:Doc[]=[];
        for(const d of docs.sort((a,b)=>str(b.data.createdAt).localeCompare(str(a.data.createdAt))).slice(0,250)){
            if(str(d.data.roomId)){try{await checkedRoom(ctx,str(d.data.roomId));}catch{continue;}}
            visible.push(d);
        }
        return {actions:await Promise.all(visible.map(d=>view(ctx,d)))};
    })],
    'POST /api/org/actions/sent':[orgRoute('actions.sent',null,async ctx=>{
        const docs=(await listDocs(ROOT(ctx.orgId))).filter(d=>str(d.data.requesterUid)===ctx.uid);
        const visible:Doc[]=[];
        for(const d of docs.sort((a,b)=>str(b.data.createdAt).localeCompare(str(a.data.createdAt))).slice(0,250)){
            if(str(d.data.roomId)){try{await checkedRoom(ctx,str(d.data.roomId));}catch{continue;}}
            visible.push(d);
        }
        return {actions:await Promise.all(visible.map(d=>view(ctx,d)))};
    })],
    'POST /api/org/actions/respond':[orgRoute('actions.respond',null,async ctx=>{
        const id=str(ctx.body.actionId),decision=str(ctx.body.decision);
        const {doc,ids}=await target(ctx,id);
        if(!ids.includes(ctx.uid))throw new HttpError(403,'Only an assignee can respond.');
        if(!['accept','review','decline'].includes(decision))throw new HttpError(400,'Choose an action response.');
        const path=assignees(ctx.orgId,id)+'/'+ctx.uid;
        const old=await getDoc(path);
        if(!old||str(old.data.decision)!=='pending')throw new HttpError(409,'Response already recorded.');
        const note=str(ctx.body.note).trim().slice(0,1400);
        if(decision!=='accept'&&note.length<5)throw new HttpError(400,'Add an explanation.');
        const next=decision==='accept'?'accepted':decision==='review'?'review':'declined';
        const wrote=await writeDoc(path,{...old.data,decision:next,reviewNote:note,updatedAt:today(),acceptedAt:decision==='accept'?today():''},{updateTime:old.updateTime});
        if(!wrote)throw new HttpError(409,'Action changed. Refresh.');
        await publishActionUpdate(ctx,doc,ctx.uid,decision==='accept'?'Accepted':decision==='review'?'Review requested':'Declined',note);
        await record(ctx,'respond',id);
        return {ok:true};
    })],
    'POST /api/org/actions/progress':[orgRoute('actions.progress',null,async ctx=>{
        const id=str(ctx.body.actionId),status=str(ctx.body.status);
        const {doc,ids}=await target(ctx,id);
        if(!ids.includes(ctx.uid))throw new HttpError(403,'Only your own assigned actions can be updated.');
        if(!['open','closed','canceled'].includes(status))throw new HttpError(400,'Choose Open, Closed or Canceled.');
        const path=assignees(ctx.orgId,id)+'/'+ctx.uid;
        const current=await getDoc(path);
        if(!current||str(current.data.decision)!=='accepted'||str(current.data.acknowledgedAt))throw new HttpError(409,'Accept the action before updating progress, or it has already been acknowledged.');
        const note=str(ctx.body.note).trim().slice(0,1400);
        if(status==='canceled'&&note.length<5)throw new HttpError(400,'Cancellation requires a reason.');
        const stamp=today(),history=Array.isArray(current.data.progressNotes)?current.data.progressNotes:[];
        const photoPath=validateActionPhoto(ctx,ctx.body.photoPath);
        const wrote=await writeDoc(path,{...current.data,status,updatedAt:stamp,
            closedAt:status==='closed'?stamp:'',acknowledgedAt:'',acknowledgementNote:'',
            progressNotes:note||photoPath?[...history.slice(-99),{note,at:stamp,by:ctx.uid,photoPath}]:history,
        },{updateTime:current.updateTime});
        if(!wrote)throw new HttpError(409,'Progress changed. Refresh.');
        await publishActionUpdate(ctx,doc,ctx.uid,status==='closed'?'Submitted for requester acknowledgement':status==='canceled'?'Canceled':'Progress updated',note);
        await record(ctx,'progress',id);
        return {ok:true};
    })],
    'POST /api/org/actions/acknowledge':[orgRoute('actions.acknowledge',null,async ctx=>{
        const id=str(ctx.body.actionId),uid=str(ctx.body.uid),decision=str(ctx.body.decision);
        const {doc,ids}=await target(ctx,id);
        if(str(doc.data.requesterUid)!==ctx.uid||!ids.includes(uid))throw new HttpError(403,'Only the requester can acknowledge the assignee’s closure.');
        if(!['acknowledge','return'].includes(decision))throw new HttpError(400,'Choose acknowledgment or return.');
        const path=assignees(ctx.orgId,id)+'/'+uid,current=await getDoc(path);
        if(!current||str(current.data.decision)!=='accepted'||str(current.data.status)!=='closed'||str(current.data.acknowledgedAt))throw new HttpError(409,'Not awaiting your acknowledgement.');
        const note=str(ctx.body.note).trim().slice(0,1400);
        if(decision==='return'&&note.length<5)throw new HttpError(400,'Explain the further work required.');
        const stamp=today(),history=Array.isArray(current.data.progressNotes)?current.data.progressNotes:[];
        const wrote=await writeDoc(path,{...current.data,status:decision==='return'?'open':'closed',
            closedAt:decision==='return'?'':str(current.data.closedAt),
            acknowledgedAt:decision==='acknowledge'?stamp:'',acknowledgementNote:note,updatedAt:stamp,
            progressNotes:note?[...history.slice(-99),{note,at:stamp,by:ctx.uid,type:decision}]:history,
        },{updateTime:current.updateTime});
        if(!wrote)throw new HttpError(409,'Action changed. Refresh.');
        await publishActionUpdate(ctx,doc,uid,decision==='acknowledge'?'Closure acknowledged':'Returned for more work',note);
        await record(ctx,'acknowledge',id);
        return {ok:true};
    })],
    'POST /api/org/actions/create':[orgRoute('actions.create',null,async ctx=>{
        const source=str(ctx.body.source);
        if(source!=='calendar')throw new HttpError(400,'Actions originating in Email must be created when sending the email.');
        const sourceId=str(ctx.body.sourceId);
        if(!/^[a-zA-Z0-9_-]{8,100}$/.test(sourceId))throw new HttpError(400,'Choose a calendar event.');
        const ev=await getDoc('organizations/'+ctx.orgId+'/calendar_events/'+sourceId);
        if(!ev||str(ev.data.organizerUid)!==ctx.uid)throw new HttpError(403,'Only the calendar event owner can propose actions.');
        const recipientUids=toIds(ctx.body.recipientUids);
        const id=await createMonitoredAction(ctx,{source:'calendar',sourceId,recipientUids,
            title:str(ctx.body.title),description:str(ctx.body.description),deadline:str(ctx.body.deadline),
            photoPath:str(ctx.body.photoPath)});
        return {id};
    })],
};
