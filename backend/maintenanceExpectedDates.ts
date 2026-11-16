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
export function protectExpectedDates(d:Obj,b:Record<string,unknown>){const dates=expectedDates(d);for(const k of ['expectedStart','expectedEnd','initialScheduledStart','initialScheduledEnd'] as const){if(b[k]!==undefined&&str(b[k])!== (k==='expectedStart'||k==='initialScheduledStart'?dates.expectedStart:dates.expectedEnd))throw new HttpError(409,'Expected dates are immutable after Work Order creation. Change scheduled dates instead.');}return dates;}
