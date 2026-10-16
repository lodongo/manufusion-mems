import { HttpError, getDoc, listDocs, nowIso, randomId, str, writeDoc, updateFields, deleteDoc } from './core';
import { orgRoute } from './guards';
import { verifiedPeople } from './chatCommon';
import { audit } from './audit';

const root=(orgId:string)=>'organizations/'+orgId+'/calendar_events';
const validId=/^ev_[a-zA-Z0-9_-]{12,60}$/;
const choices=new Set(['none','daily','weekly','monthly']);
const asIds=(value:unknown)=>[...new Set(Array.isArray(value)?value.map(str).filter(Boolean):[])];
const date=(value:unknown)=>{
    const raw=str(value);
    const ms=Date.parse(raw);
    if(!raw||!Number.isFinite(ms)||raw.length>45)throw new HttpError(400,'Choose a valid event date and time.');
    return new Date(ms).toISOString();
};
async function read(ctx:{orgId:string;uid:string},id:string){
    if(!validId.test(id))throw new HttpError(400,'Choose an event.');
    const event=await getDoc(root(ctx.orgId)+'/'+id);
    if(!event||(str(event.data.organizerUid)!==ctx.uid&&!asIds(event.data.attendeeUids).includes(ctx.uid)))
        throw new HttpError(403,'Event is not on your calendar.');
    return event;
}
export const calendarRoutes={
    'POST /api/org/mail/calendar/activity':[orgRoute('calendar.activity',null,async ctx=>{
        const id=str(ctx.body.id);
        await read(ctx,id);
        const entries=await listDocs(root(ctx.orgId)+'/'+id+'/activity');
        return {items:entries.sort((a,b)=>str(b.data.createdAt).localeCompare(str(a.data.createdAt))).slice(0,100).map(d=>({id:d.id,...d.data}))};
    })],
    'POST /api/org/mail/calendar/list':[orgRoute('calendar.list',null,async ctx=>{
        const events=await listDocs(root(ctx.orgId));
        return {events:events.filter(e=>str(e.data.organizerUid)===ctx.uid||asIds(e.data.attendeeUids).includes(ctx.uid))
            .sort((a,b)=>str(a.data.startsAt).localeCompare(str(b.data.startsAt))).map(e=>({id:e.id,...e.data}))};
    })],
    'POST /api/org/mail/calendar/save':[orgRoute('calendar.save',null,async ctx=>{
        const id=str(ctx.body.id)||'ev_'+randomId(12);
        if(!validId.test(id))throw new HttpError(400,'Invalid event ID.');
        const existing=await getDoc(root(ctx.orgId)+'/'+id);
        if(existing&&str(existing.data.organizerUid)!==ctx.uid)throw new HttpError(403,'Only the event organizer can edit it.');
        const title=str(ctx.body.title).trim().slice(0,160),description=str(ctx.body.description).trim().slice(0,2000);
        const location=str(ctx.body.location).trim().slice(0,200);
        const startsAt=date(ctx.body.startsAt),endsAt=date(ctx.body.endsAt);
        if(Date.parse(endsAt)<=Date.parse(startsAt))throw new HttpError(400,'The end must come after the start.');
        if(Date.parse(endsAt)-Date.parse(startsAt)>31*86400_000)throw new HttpError(400,'A calendar event cannot span more than 31 days.');
        if(title.length<3)throw new HttpError(400,'Enter an event name.');
        const recurrence=str(ctx.body.recurrence)||'none';
        if(!choices.has(recurrence))throw new HttpError(400,'Choose a recurrence.');
        const attendeeUids=asIds(ctx.body.attendeeUids).filter(uid=>uid!==ctx.uid);
        if(attendeeUids.length>49)throw new HttpError(400,'Maximum 49 invited colleagues.');
        await verifiedPeople(ctx,[ctx.uid,...attendeeUids]);
        const now=nowIso(),oldStatus=existing?.data.attendeeStatus;
        const prev=oldStatus&&typeof oldStatus==='object'&&!Array.isArray(oldStatus)?oldStatus:{};
        const attendeeStatus:Object=Object.fromEntries(attendeeUids.map(uid=>[uid,(prev as Record<string,unknown>)[uid]||'invited']));
        const record={
            title,description,location,startsAt,endsAt,allDay:ctx.body.allDay===true,
            recurrence,attendeeUids,attendeeStatus,organizerUid:ctx.uid,
            reminderMinutes:Math.max(0,Math.min(1440,Number(ctx.body.reminderMinutes)||0)),
            updatedAt:now,createdAt:str(existing?.data.createdAt)||now,
        };
        await writeDoc(root(ctx.orgId)+'/'+id,record);
        await audit([{category:'interaction',action:existing?'calendar.update':'calendar.create',actor:ctx.actor,
            orgId:ctx.orgId,meta:ctx.meta,target:{type:'calendar_event',id}}]);
        return {event:{id,...record}};
    })],
    'POST /api/org/mail/calendar/rsvp':[orgRoute('calendar.rsvp',null,async ctx=>{
        const id=str(ctx.body.id),event=await read(ctx,id),decision=str(ctx.body.decision);
        if(!['accepted','tentative','declined'].includes(decision))throw new HttpError(400,'Choose a response.');
        if(!asIds(event.data.attendeeUids).includes(ctx.uid))throw new HttpError(403,'Only an invited colleague can respond.');
        const status=event.data.attendeeStatus&&typeof event.data.attendeeStatus==='object'
            &&!Array.isArray(event.data.attendeeStatus)?event.data.attendeeStatus:{};
        await updateFields(root(ctx.orgId)+'/'+id,{attendeeStatus:{...status,[ctx.uid]:decision},updatedAt:nowIso()});
        return {ok:true};
    })],
    'POST /api/org/mail/calendar/delete':[orgRoute('calendar.delete',null,async ctx=>{
        const event=await read(ctx,str(ctx.body.id));
        if(str(event.data.organizerUid)!==ctx.uid)throw new HttpError(403,'Only the organizer can remove this calendar event.');
        await deleteDoc(root(ctx.orgId)+'/'+event.id);
        return {ok:true};
    })],
};
