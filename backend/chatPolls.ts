import { HttpError,getDoc,listDocs,nowIso,randomId,str,updateFields,writeDoc } from './core';
import { orgRoute,type OrgContext } from './guards';
import { audit } from './audit';
import { checkedRoom,notifyRoom,ID_RE,MESSAGE_ROOT,ROOM_PATH } from './chatCommon';

const root=(org:string,room:string)=>'organizations/'+org+'/chat_rooms/'+room+'/polls';
const pollPath=(org:string,room:string,id:string)=>root(org,room)+'/'+id;
const ballotPath=(org:string,room:string,id:string)=>pollPath(org,room,id)+'/votes';
async function checkedPoll(ctx:OrgContext,roomId:string,pollId:string) {
    const room=await checkedRoom(ctx,roomId);
    if(str(room.data.kind)!=='group')throw new HttpError(400,'Polls are available in group chats.');
    if(!ID_RE.test(pollId))throw new HttpError(400,'Choose a poll.');
    const poll=await getDoc(pollPath(ctx.orgId,roomId,pollId));
    if(!poll)throw new HttpError(404,'Poll not found.');
    return {room,poll};
}
async function publish(ctx:OrgContext,roomId:string) {
    const room=await checkedRoom(ctx,roomId);
    await notifyRoom(ctx,room,{event:'poll'});
}
async function out(ctx:OrgContext,roomId:string,doc:Awaited<ReturnType<typeof getDoc>>) {
    if(!doc)throw new HttpError(404,'Poll not found.');
    const votes=await listDocs(ballotPath(ctx.orgId,roomId,doc.id));
    const options=Array.isArray(doc.data.options)?doc.data.options.map(str):[];
    const self=votes.find(d=>d.id===ctx.uid);
    const reveal=doc.data.instantResults===true||doc.data.closed===true;
    const counts=options.map((_,i)=>votes.filter(v=>Array.isArray(v.data.indices)&&v.data.indices.includes(i)).length);
    return {
        id:doc.id,question:str(doc.data.question),options,createdBy:str(doc.data.createdBy),
        createdAt:str(doc.data.createdAt),closed:doc.data.closed===true,
        anonymous:doc.data.anonymous===true,instantResults:doc.data.instantResults===true,
        multiple:doc.data.multiple===true,hasVoted:!!self,
        ownVotes:Array.isArray(self?.data.indices)?self?.data.indices:[],
        totalVoters:reveal?votes.length:null,counts:reveal?counts:null,
        voters:reveal&&doc.data.anonymous!==true?votes.map(d=>({uid:d.id,indices:d.data.indices})):[]
    };
}
const log=(ctx:OrgContext,name:string,id:string)=>audit([{
    category:'interaction',action:'chat.poll.'+name,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,
    target:{type:'chat_poll',id}
}]);
export const chatPollRoutes={
    'POST /api/org/quick/chat/poll/create':[orgRoute('chat.poll.create',null,async ctx=>{
        const roomId=str(ctx.body.roomId),room=await checkedRoom(ctx,roomId);
        if(str(room.data.kind)!=='group')throw new HttpError(400,'Polls require a group.');
        const question=str(ctx.body.question).trim().slice(0,260);
        const options=(Array.isArray(ctx.body.options)?ctx.body.options:[]).map(str).map(x=>x.trim().slice(0,130)).filter(Boolean);
        if(question.length<5||options.length<2||options.length>10||new Set(options.map(x=>x.toLowerCase())).size!==options.length){
            throw new HttpError(400,'Enter a question and 2–10 different options.');
        }
        const id='poll_'+randomId(12);
        const saved=await writeDoc(pollPath(ctx.orgId,roomId,id),{
            question,options,createdBy:ctx.uid,createdAt:nowIso(),closed:false,closedAt:'',
            anonymous:ctx.body.anonymous===true,instantResults:ctx.body.instantResults===true,
            multiple:ctx.body.multiple===true
        },{exists:false});
        if(!saved)throw new HttpError(409,'Could not create poll.');
        const stamp=nowIso();
        await writeDoc(MESSAGE_ROOT(ctx.orgId,roomId)+'/event_'+id,{
            senderUid:ctx.uid,text:'',eventKind:'poll',referenceId:id,
            createdAt:stamp,deletedForAll:false,attachment:{},reactions:{}
        },{exists:false});
        await updateFields(ROOM_PATH(ctx.orgId,roomId),{
            lastMessage:'📊 Poll: '+question.slice(0,85),
            lastSenderUid:ctx.uid,lastMessageId:'event_'+id,lastMessageAt:stamp,updatedAt:stamp
        });
        await log(ctx,'create',id);await publish(ctx,roomId);
        return {poll:await out(ctx,roomId,await getDoc(pollPath(ctx.orgId,roomId,id)))};
    })],
    'POST /api/org/quick/chat/poll/list':[orgRoute('chat.poll.list',null,async ctx=>{
        const roomId=str(ctx.body.roomId);
        const room=await checkedRoom(ctx,roomId);
        if(str(room.data.kind)!=='group')return {polls:[]};
        const all=await listDocs(root(ctx.orgId,roomId));
        return {polls:await Promise.all(all.sort((a,b)=>str(b.data.createdAt).localeCompare(str(a.data.createdAt)))
            .slice(0,60).map(p=>out(ctx,roomId,p)))};
    })],
    'POST /api/org/quick/chat/poll/vote':[orgRoute('chat.poll.vote',null,async ctx=>{
        const roomId=str(ctx.body.roomId),id=str(ctx.body.pollId);
        const {poll}=await checkedPoll(ctx,roomId,id);
        if(poll.data.closed===true)throw new HttpError(409,'Voting has closed.');
        const options=Array.isArray(poll.data.options)?poll.data.options:[];
        const indices=[...new Set(Array.isArray(ctx.body.indices)?ctx.body.indices:[])];
        if(!indices.length||indices.some(n=>!Number.isInteger(n)||n<0||n>=options.length)
            ||(poll.data.multiple!==true&&indices.length!==1)){
            throw new HttpError(400,'Select a valid poll option.');
        }
        const saved=await writeDoc(ballotPath(ctx.orgId,roomId,id)+'/'+ctx.uid,{
            indices,createdAt:nowIso()
        },{exists:false});
        if(!saved)throw new HttpError(409,'Your vote has already been recorded.');
        await log(ctx,'vote',id);await publish(ctx,roomId);
        return {poll:await out(ctx,roomId,await getDoc(pollPath(ctx.orgId,roomId,id)))};
    })],
    'POST /api/org/quick/chat/poll/close':[orgRoute('chat.poll.close',null,async ctx=>{
        const roomId=str(ctx.body.roomId),id=str(ctx.body.pollId);
        const {poll}=await checkedPoll(ctx,roomId,id);
        if(str(poll.data.createdBy)!==ctx.uid)throw new HttpError(403,'Only the poll creator can close it.');
        if(poll.data.closed!==true)await updateFields(pollPath(ctx.orgId,roomId,id),{closed:true,closedAt:nowIso()});
        await log(ctx,'close',id);await publish(ctx,roomId);
        return {poll:await out(ctx,roomId,await getDoc(pollPath(ctx.orgId,roomId,id)))};
    })]
};
