import {randomUUID} from 'node:crypto';
import {getDoc,listDocs,writeDoc,isObj,str,nowIso,HttpError,type Doc,type Obj} from './core';
import {orgRoute,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {audit} from './audit';
import {withLock,commit} from './finCore';
import {capacityContext,type Artisan} from './maintenanceCapacity';
import {timeConflict,TIME_CLASSES,type TimeBooking} from './maintenanceTimeCore';
import {outsideExecutionAccess} from './maintenanceWorkGroupPolicy';
const rows=(v:unknown)=>Array.isArray(v)?v.filter(isObj):[];
const texts=(v:unknown)=>Array.isArray(v)?v.map(str).filter(Boolean):[];
const obj=(v:unknown)=>isObj(v)?v:{};
const record=(d:Doc):TimeBooking=>({uid:str(d.data.uid),start:str(d.data.start),end:str(d.data.end),status:str(d.data.status)});
const validId=(v:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(v);
function instant(s:unknown){const n=Date.parse(str(s));if(!Number.isFinite(n))throw new HttpError(400,'Enter a valid date and time.');return n;}
async function timeRoute(ctx:OrgContext){
 if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'Maintenance is not enabled.');
 const b=ctx.body,action=str(b.action)||'read',uid=str(b.uid)||ctx.uid,base='organizations/'+ctx.orgId,col=base+'/maintenance_time_bookings';
 if(!validId(uid))throw new HttpError(400,'Invalid employee.');
 const c=await capacityContext(ctx),s=await scopeOf(ctx),person=c.artisans.find(a=>a.id===uid);
 const manages=(a:Artisan)=>a.paths.some(p=>canAt(ctx,'MNT.WO.plan',p,s)||canAt(ctx,'MNT.WO.close',p,s));
 if(uid!==ctx.uid&&(!person||!manages(person)))throw new HttpError(403,'Scoped maintenance supervisor required.');
 const all=await listDocs(col),mine=all.filter(d=>d.data.uid===uid),id=str(b.id),existing=id&&validId(id)?mine.find(d=>d.id===id):undefined;
 const woCode=str(existing?.data.woCode)||str(b.woCode),taskId=str(existing?.data.taskId)||str(b.taskId);
 let wo:Doc|undefined;
 if(woCode){
  if(!/^WO\d{8}(?:_[1-9]\d{0,8})?$/.test(woCode)||!validId(taskId))throw new HttpError(400,'Choose a work order activity.');
  wo=await getDoc(base+'/work_orders/'+woCode);
  if(!wo)throw new HttpError(404,'Work order not found.');
  if(!canAt(ctx,'MNT.view',texts(wo.data.path),s)&&!outsideExecutionAccess(ctx.workGroupPolicy,wo,taskId)&&!(existing&&uid===ctx.uid&&existing.data.status==='running'))throw new HttpError(403,'Work order access required.');
 }
 const allocation=texts(obj(obj(obj(wo?.data.taskPlanning)[taskId]).allocation).personnel);
 if(action==='read'){
  const recent=mine.filter(d=>!woCode||d.data.woCode===woCode&&d.data.taskId===taskId).sort((a,b)=>str(b.data.start).localeCompare(str(a.data.start))).slice(0,40),active=mine.find(d=>d.data.status==='running');
  return {me:ctx.uid,employeeUid:uid,people:c.artisans.filter(a=>a.id===ctx.uid||manages(a)).map(a=>({id:a.id,name:a.name})),classes:TIME_CLASSES,entries:recent.map(d=>({id:d.id,...d.data})),active:active?{id:active.id,...active.data}:null,canBook:!!person&&(!woCode||allocation.includes(uid))};
 }
 if(!['start','pause','resume','complete','manual','correct'].includes(action))throw new HttpError(400,'Unknown time action.');
 const supervisor=uid!==ctx.uid,note=str(b.note).trim().slice(0,500);
 if(supervisor&&note.length<10)throw new HttpError(400,'Supervisor bookings require a reason (at least 10 characters).');
 const at=nowIso(),now=Date.parse(at);
 if(action==='pause'||action==='complete'){
  if(!existing||existing.data.status!=='running')throw new HttpError(409,'Choose the running time booking.');
  if(now<=instant(existing.data.start)||now-instant(existing.data.start)>36*3600000)throw new HttpError(409,'Invalid or overlong timer. Ask a supervisor to correct the interval.');
  if(!await writeDoc(col+'/'+existing.id,{...existing.data,end:at,status:'recorded',stopReason:action==='pause'?'paused':'completed',stoppedBy:ctx.uid,stoppedAt:at,stopNote:note},{updateTime:existing.updateTime}))throw new HttpError(409,'Timer changed. Reload.');
  await audit([{category:'maintenance',action:'mnt.time.'+action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:existing.id},details:note}]);return {ok:true};
 }
 if(!person)throw new HttpError(403,'An active maintenance execution role is required.');
 const correcting=action==='correct',manual=action==='manual'||correcting;
 if(correcting&&(!supervisor||!existing||!['recorded','running'].includes(str(existing.data.status))||note.length<10))throw new HttpError(403,'A scoped supervisor must correct an existing entry with a reason.');
 const classCode=woCode?'DIRECT':correcting?str(existing?.data.classCode):str(b.classCode),cls=TIME_CLASSES.find(x=>x.code===classCode);
 if(!cls||cls.requiresOrder!==!!woCode)throw new HttpError(400,'Choose a valid time classification.');
 if(!woCode&&note.length<5)throw new HttpError(400,'Describe the non-work-order booking.');
 if(wo){
  const task=rows(wo.data.assessmentTasks).find(x=>x.id===taskId),execution=obj(obj(wo.data.taskExecution)[taskId]);
  if(!task||!allocation.includes(uid))throw new HttpError(403,'Employee must be allocated to this activity.');
  if(supervisor&&!canAt(ctx,'MNT.WO.plan',texts(wo.data.path),s)&&!canAt(ctx,'MNT.WO.close',texts(wo.data.path),s))throw new HttpError(403,'Supervisor authority at the work order location is required.');
  if(!manual&&(execution.status!=='in_progress'||['closed','cancelled'].includes(str(wo.data.status))))throw new HttpError(409,'Start physical task execution before starting a personal timer.');
  if(manual&&!execution.startedAt)throw new HttpError(409,'No recorded activity execution start exists.');
 }
 const start=manual?instant(b.start):now,end=manual?instant(b.end):now+1;
 if(start>=end||end-start>36*3600000||manual&&end>now)throw new HttpError(400,'Book a positive interval up to 36 hours, not in the future.');
 if(wo&&manual){const ex=obj(obj(wo.data.taskExecution)[taskId]);if(start<Date.parse(str(ex.startedAt))||end>(Date.parse(str(ex.physicalFinishedAt||ex.completedAt))||now))throw new HttpError(409,'Manual entry must fall within recorded task execution.');}
 // Legacy date-only records have unknown exact intervals. Conservatively reject a same-date booking.
 const orders=await listDocs(base+'/work_orders'),startDay=new Date(start).toISOString().slice(0,10),endDay=new Date(end-1).toISOString().slice(0,10);
 if(orders.some(w=>rows(w.data.timeLogs).some(l=>l.uid===uid&&str(l.date)>=startDay&&str(l.date)<=endDay)))throw new HttpError(409,'Legacy duration-only booking on this date: reconcile it before adding a precise interval.');
 const others=mine.filter(d=>!correcting||d.id!==existing!.id).map(record);
 if(others.some(d=>d.status==='running')||timeConflict(others,uid,{start,end},now))throw new HttpError(409,'Another personal timer or overlapping booking exists.');
 const docId=randomUUID().replaceAll('-',''),entry:Obj={uid,name:person.name,groupId:person.groupId,groupName:person.groupName,woCode,taskId,classCode,classification:cls.label,productive:cls.productive,start:new Date(start).toISOString(),end:manual?new Date(end).toISOString():'',status:manual?'recorded':'running',source:supervisor?'supervisor':manual?'manual':'live',createdAt:at,createdBy:ctx.uid,note,...(correcting?{supersedes:existing!.id}:{})};
 if(correcting)await commit([{path:col+'/'+existing!.id,fields:{...existing!.data,status:'superseded',supersededBy:docId,correctionReason:note,correctedBy:ctx.uid,correctedAt:at},updateTime:existing!.updateTime},{path:col+'/'+docId,fields:entry,exists:false}]);else if(!await writeDoc(col+'/'+docId,entry,{exists:false}))throw new HttpError(409,'Booking could not be created.');
 await audit([{category:'maintenance',action:'mnt.time.'+action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:docId},details:note}]);return {ok:true,id:docId};
}
export const maintenanceTimeRoutes={'POST /api/org/mnt/workforce/time':[orgRoute('org.mnt.workforce.time','MNT.view',async ctx=>withLock(ctx.orgId,'maintenance_operations',()=>timeRoute(ctx)))]};
