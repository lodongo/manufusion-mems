import {reviewAssessmentPrerequisites} from './maintenanceAssessmentReview';
import {cycleRestricted,validateCycleDates} from './maintenanceCycle';
import {str,HttpError,type Obj} from './core';
const day=(v:unknown)=>{const s=str(v);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))?s:'';};
export function expectedDates(d:Obj){
 const first=(Array.isArray(d.dateChanges)?d.dateChanges:[]).find(x=>x&&typeof x==='object'&&day((x as Obj).fromStart)&&day((x as Obj).fromEnd)) as Obj|undefined;
 const originalStart=day(d.initialScheduledStart)||day(first?.fromStart),originalEnd=day(d.initialScheduledEnd)||day(first?.fromEnd);
 const expectedStart=day(d.expectedStart)||originalStart||day(d.scheduledStart),expectedEnd=day(d.expectedEnd)||originalEnd||day(d.scheduledEnd);
 const expectedDateSource=str(d.expectedDateSource)||(day(d.expectedStart)&&day(d.expectedEnd)?'original':originalStart&&originalEnd?'historical_initial':expectedStart&&expectedEnd?'legacy_schedule_snapshot':'unavailable');
 return {expectedStart,expectedEnd,expectedDateSource};
}
export function newExpectedDates(start:string,end:string){return {expectedStart:start,expectedEnd:end,expectedDateSource:'original'};}
export function expectedDatesLocked(d:Obj):boolean{
 return !!str(d.expectedDatesLockedAt)||d.executionMode!=='confirmed_request'||str(d.status)!=='planning'||!reviewAssessmentPrerequisites(d as Parameters<typeof reviewAssessmentPrerequisites>[0],'__expected_date_lock__');
}
export function nextCycleEnd(start:string){return new Date(Date.parse(start+'T00:00:00Z')+6*86400000).toISOString().slice(0,10);}
export function validateExpectedWindow(type:string,start:string,end:string,cycle:{today:string;nextStart:string},existing?:Obj){
 const previous=existing?expectedDates(existing):null;
 if(previous&&previous.expectedStart===start&&previous.expectedEnd===end&&str(existing?.maintenanceTypeCode)===type)return;
 validateCycleDates(type,start,end,cycle);
 if(cycleRestricted(type)&&end>nextCycleEnd(cycle.nextStart))throw new HttpError(400,'Expected dates must both fall within the next maintenance cycle: '+cycle.nextStart+' to '+nextCycleEnd(cycle.nextStart)+'.');
}
export function editExpectedDates(d:Obj,b:Record<string,unknown>,type:string,cycle:{today:string;nextStart:string}){
 if(expectedDatesLocked(d))return protectExpectedDates(d,b);
 const old=expectedDates(d),start=b.expectedStart===undefined?old.expectedStart:str(b.expectedStart),end=b.expectedEnd===undefined?old.expectedEnd:str(b.expectedEnd);
 validateExpectedWindow(type,start,end,cycle,d);
 return {...old,expectedStart:start,expectedEnd:end,expectedDateSource:start===old.expectedStart&&end===old.expectedEnd?old.expectedDateSource:'original'};
}
export function expectedDateCompletionPatch(d:Obj,at:string):Obj{
 return !str(d.expectedDatesLockedAt)&&expectedDatesLocked(d)?{...expectedDates(d),expectedDatesLockedAt:at}:{};
}
export function protectExpectedDates(d:Obj,b:Record<string,unknown>){const dates=expectedDates(d);for(const k of ['expectedStart','expectedEnd','initialScheduledStart','initialScheduledEnd'] as const){if(b[k]!==undefined&&str(b[k])!== (k==='expectedStart'||k==='initialScheduledStart'?dates.expectedStart:dates.expectedEnd))throw new HttpError(409,'Expected dates are immutable after Work Order creation. Change scheduled dates instead.');}return dates;}
