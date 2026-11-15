import {createHash} from 'node:crypto';
import {getDoc,listDocs,writeDoc,nowIso,str,isObj,HttpError,type Doc} from './core';
import {orgRoute,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {withLock} from './finCore';
import {audit} from './audit';
import {capacityContext} from './maintenanceCapacity';
import {availability,ruleAt,validDay} from './maintenanceCapacityCore';
import {midnight} from './maintenanceAnalyticsCalendar';
import {dateAdd} from './maintenanceAnalyticsCore';
import {reconcileDay,type SheetEntry} from './maintenanceTimesheetCore';
export function toSheetEntry(d:Doc):SheetEntry{return {id:d.id,start:str(d.data.start),end:str(d.data.end),status:str(d.data.status),classCode:str(d.data.classCode),classification:str(d.data.classification),productive:d.data.productive===true,deductible:d.data.deductible===true,delayOwner:str(d.data.delayOwner)};}
async function sheet(ctx:OrgContext){
 if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'Maintenance is not enabled.');
 const b=ctx.body,action=str(b.action)||'read',uid=str(b.uid)||ctx.uid,from=str(b.from),through=str(b.through),root='organizations/'+ctx.orgId;
 if(!validDay(from)||!validDay(through)||from>through||Date.parse(through)-Date.parse(from)>30*86400000||!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw new HttpError(400,'Choose an employee and up to 31 days.');
 const c=await capacityContext(ctx,from),s=await scopeOf(ctx),manages=(a:typeof c.artisans[number])=>ctx.role==='org_super_admin'||a.paths.some(p=>canAt(ctx,'MNT.WO.plan',p,s)||canAt(ctx,'MNT.WO.close',p,s)),people=c.artisans.filter(a=>a.id===ctx.uid||manages(a)),person=people.find(a=>a.id===uid);
 if(!person){if(action==='read'&&uid===ctx.uid)return {me:ctx.uid,people:people.map(a=>({id:a.id,name:a.name})),days:[],message:'Select an artisan.'};throw new HttpError(403,'Timesheet access is restricted to the employee and scoped supervision.');}
 const logs=(await listDocs(root+'/maintenance_time_bookings')).filter(d=>d.data.uid===uid),entries=logs.map(toSheetEntry),days=[],now=Date.now();
 // Legacy date-only entries are disclosed, not conflated with exact intervals.
 const legacy=(await listDocs(root+'/work_orders')).flatMap(w=>Array.isArray(w.data.timeLogs)?w.data.timeLogs.filter(isObj).filter(l=>l.uid===uid&&str(l.date)>=from&&str(l.date)<=through):[]);
 for(let day=from;day<=through;day=dateAdd(day,1)){const r=ruleAt(c.rules,person.scopeKeys,day),zone=r?.values.zone||'UTC',bounds={start:midnight(day,zone),end:midnight(dateAdd(day,1),zone)},av=availability(c.rules,person.scopeKeys,day,day,c.approvedLeave.filter(l=>l.uid===uid),[],c.adjustments),rec=reconcileDay(av.net,bounds,entries,now);days.push({day,zone,capacityKnown:!!r,scheduledNetHours:r?av.netHours:null,...rec,netHours:r?rec.netHours:null,unaccountedHours:r?rec.unaccountedHours:null,accountability:r?rec.accountability:null,utilization:r?rec.utilization:null,legacyEntries:legacy.filter(l=>l.date===day).length,finished:bounds.end<=now});}
 const fingerprint=createHash('sha256').update(JSON.stringify(days)).digest('hex'),id=uid+'_'+from+'_'+through,path=root+'/maintenance_timesheets/'+id,prior=await getDoc(path),stale=!!prior&&prior.data.fingerprint!==fingerprint;
 const canVerify=uid!==ctx.uid&&manages(person),note=str(b.note).trim().slice(0,500);
 if(action==='read')return {me:ctx.uid,people:people.map(a=>({id:a.id,name:a.name})),days,uid,from,through,state:prior?stale?'stale':str(prior.data.status):'open',canVerify,version:Number(prior?.data.version)||0};
 if(!['submit','verify','return'].includes(action)||note.length<10)throw new HttpError(400,'Provide a reason or declaration (at least 10 characters).');
 if(b.expectedVersion!==(Number(prior?.data.version)||0))throw new HttpError(409,'Timesheet changed. Reload.');
 if(action==='submit'){
  if(uid!==ctx.uid)throw new HttpError(403,'Only the employee may submit their timesheet.');
  if(days.some(d=>!d.finished||!d.capacityKnown||d.pendingCount>0||d.legacyEntries>0))throw new HttpError(409,'Complete the reporting days, resolve pending or legacy time and configure capacity before submission.');
 }else if(!canVerify||!prior||prior.data.status!=='submitted'||stale||prior.data.submittedBy===ctx.uid)throw new HttpError(403,'Independent supervisor review of the current submitted sheet is required.');
 const status=action==='submit'?'submitted':action==='verify'?'verified':'returned',at=nowIso(),version=(Number(prior?.data.version)||0)+1;
 if(!await writeDoc(path,{uid,from,through,status,version,fingerprint,days,submittedBy:action==='submit'?ctx.uid:str(prior?.data.submittedBy),updatedAt:at,updatedBy:ctx.uid,note,history:[...(Array.isArray(prior?.data.history)?prior!.data.history:[]),{action,by:ctx.uid,at,note,version,fingerprint}]},prior?{updateTime:prior.updateTime}:{exists:false}))throw new HttpError(409,'Timesheet changed.');
 await audit([{category:'maintenance',action:'mnt.timesheet.'+action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:id},details:note}]);return {ok:true};
}
export const maintenanceTimesheetRoutes={'POST /api/org/mnt/workforce/timesheet':[orgRoute('org.mnt.workforce.timesheet','MNT.view',async ctx=>str(ctx.body.action)==='read'?sheet(ctx):withLock(ctx.orgId,'maintenance_operations',()=>sheet(ctx)))]};
