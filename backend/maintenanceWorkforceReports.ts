import {getDoc,listDocs,str,isObj,HttpError,type Doc} from './core';
import {orgRoute,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {capacityContext} from './maintenanceCapacity';
import {validDay,ruleAt,availability,percent,overlap} from './maintenanceCapacityCore';
import {midnight} from './maintenanceAnalyticsCalendar';
import {dateAdd} from './maintenanceAnalyticsCore';
import {comparableSample,linkTimeBookings} from './maintenanceStandardHistory';
const obj=(v:unknown)=>isObj(v)?v:{};
const arr=(v:unknown)=>Array.isArray(v)?v.map(str).filter(Boolean):[];
const records=(v:unknown)=>Array.isArray(v)?v.filter(isObj):[];
export const maintenanceWorkforceReportRoutes={'POST /api/org/mnt/workforce/report':[orgRoute('org.mnt.workforce.report','MNT.view',async(ctx:OrgContext)=>{
 if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'Maintenance is not enabled.');
 const from=str(ctx.body.from),through=str(ctx.body.through),root='organizations/'+ctx.orgId;
 if(!validDay(from)||!validDay(through)||from>through||Date.parse(through)-Date.parse(from)>92*86400000)throw new HttpError(400,'Choose a period of up to 93 days.');
 const [c,s,orders,logs]=await Promise.all([capacityContext(ctx,from),scopeOf(ctx),listDocs(root+'/work_orders'),listDocs(root+'/maintenance_time_bookings')]);
 const manages=(p:typeof c.artisans[number])=>ctx.role==='org_super_admin'||p.paths.some(path=>canAt(ctx,'MNT.WO.plan',path,s)||canAt(ctx,'MNT.WO.close',path,s));
 const visible=c.artisans.filter(a=>a.id===ctx.uid||manages(a)),orderMap=new Map(orders.map(w=>[w.id,w])),visibleOrders=new Set(orders.filter(w=>canAt(ctx,'MNT.view',arr(w.data.path),s)).map(w=>w.id)),linked=linkTimeBookings(logs);
 const data=visible.map(a=>{
  const r=ruleAt(c.rules,a.scopeKeys,from),zone=r?.values.zone||'UTC',start=midnight(from,zone),end=midnight(dateAdd(through,1),zone),interval={start,end},capacity=availability(c.rules,a.scopeKeys,from,through,c.approvedLeave.filter(l=>l.uid===a.id),[],c.adjustments),booking=c.bookings.filter(b=>b.uid===a.id&&overlap(b,interval));
  const plan=booking.reduce((n,b)=>n+Math.max(0,Math.min(end,b.end)-Math.max(start,b.start))/3600000,0),slots=booking.sort((x,y)=>x.start-y.start).slice(0,200).map(b=>{const w=orderMap.get(b.woCode),show=!!w&&visibleOrders.has(w.id),task=show?records(w!.data.assessmentTasks).find(t=>t.id===b.taskId):null;return {start:new Date(b.start).toISOString(),end:new Date(b.end).toISOString(),code:show?b.woCode:'',task:show?str(task?.title)||str(task?.description)||b.taskId:'Other authorized assignment',final:b.final};});
  let activities=0,declared=0,firstPass=0,rework=0,followUp=0,matched=0,standard=0,actual=0,matchedPlanned=0,matchedActual=0,scheduledCompleted=0,onTime=0;
  for(const w of orders){if(!visibleOrders.has(w.id))continue;for(const [tid,raw] of Object.entries(obj(w.data.taskExecution))){
   const e=obj(raw),finish=Date.parse(str(e.physicalFinishedAt||e.completedAt));if(e.status!=='completed'||!arr(e.performers).includes(a.id)||!Number.isFinite(finish)||finish<start||finish>=end)continue;
   activities++;const feedback=obj(e.feedback),quality=str(feedback.qualityOutcome);if(['first_pass','rework_completed','follow_up'].includes(quality)){declared++;if(quality==='first_pass')firstPass++;else if(quality==='rework_completed')rework++;else followUp++;}
   const scheduled=c.bookings.filter(b=>b.uid===a.id&&b.woCode===w.id&&b.taskId===tid);if(scheduled.length===1){scheduledCompleted++;if(finish<=scheduled[0].end)onTime++;}
   const snapshot=obj(obj(w.data.taskStandardSnapshots)[tid]),sample=comparableSample(w.data,tid,linked.get(w.id+'|'+tid)||[]),earned=Number(snapshot.durationHours),personal=sample?.byPerson[a.id];if(!sample||!personal||!Number.isFinite(earned)||earned<=0)continue;
   matched++;standard+=earned;actual+=personal;if(scheduled.length===1){matchedPlanned+=(scheduled[0].end-scheduled[0].start)/3600000;matchedActual+=personal;}
  }}
  return {id:a.id,name:a.name,groupId:a.groupId,groupName:a.groupName,zone,netHours:capacity.missingDays?null:capacity.netHours,loadableHours:capacity.missingDays?null:capacity.loadableHours,plannedHours:plan,loading:capacity.missingDays?null:percent(plan,capacity.netHours),slotCount:booking.length,slots,activities,declared,firstPass,rework,followUp,matched,standardHours:matched?standard:null,measuredMatchedHours:matched?actual:null,efficiency:matched?percent(standard,actual):null,planningVariance:matchedPlanned>0?100*(matchedActual-matchedPlanned)/matchedPlanned:null,scheduledCompleted,onTime};
 });
 return {people:data,from,through,coverage:'Execution quality is an optional team declaration, not an independent individual quality rating. Efficiency uses only comparable closed activities with an approved standard, complete team time and no recorded blocking; each person’s assigned standard duration is used. Planning variance compares measured labour to matched scheduled hours. Undeclared outcomes are excluded. Scheduled activity hours include scheduled work, not downtime. Historical assignment scope uses available configuration.'};
})]};
