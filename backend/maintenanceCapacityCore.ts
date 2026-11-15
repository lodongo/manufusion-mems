import {midnight,localDay} from './maintenanceAnalyticsCalendar';
import {dateAdd} from './maintenanceAnalyticsCore';
export type Span={start:number;end:number};
export type RotationSlot={start:string;hours:number}|null;
export type Capacity={hoursPerDay:number;days:number[];loadingPercent:number;shiftStart:string;zone:string;rotation?:{anchor:string;slots:RotationSlot[]}};
export type CalendarAdjustment={scope:string;kind:'holiday'|'unavailable'|'overtime';start:string;end:string;status:string};
export type CapacityRule={scope:string;effectiveFrom:string;values:Capacity};
export const validDay=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export function validateCapacity(raw:unknown):Capacity{
 const d=raw as Partial<Capacity>;if(!d||typeof d!=='object'||typeof d.hoursPerDay!=='number'||!Number.isFinite(d.hoursPerDay)||d.hoursPerDay<=0||d.hoursPerDay>24||!Array.isArray(d.days)||!d.days.length||d.days.some(x=>!Number.isInteger(x)||x<0||x>6)||new Set(d.days).size!==d.days.length||typeof d.loadingPercent!=='number'||!Number.isFinite(d.loadingPercent)||d.loadingPercent<0||d.loadingPercent>100||typeof d.shiftStart!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.shiftStart)||typeof d.zone!=='string')throw Error('Enter valid shift hours, working days, target loading and timezone.');
 new Intl.DateTimeFormat('en',{timeZone:d.zone});
 let rotation:Capacity['rotation'];if(d.rotation!==undefined){const r=d.rotation;if(!r||!validDay(r.anchor)||!Array.isArray(r.slots)||!r.slots.length||r.slots.length>42||!r.slots.some(s=>s!==null)||r.slots.some(s=>s!==null&&(!s||typeof s.start!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start)||typeof s.hours!=='number'||!Number.isFinite(s.hours)||s.hours<=0||s.hours>24)))throw Error('Choose a valid rotation anchor and 1–42 daily shift slots.');
 rotation={anchor:r.anchor,slots:r.slots.map(s=>s?{start:s.start,hours:s.hours}:null)};}
 return {hoursPerDay:d.hoursPerDay,days:[...d.days].sort(),loadingPercent:d.loadingPercent,shiftStart:d.shiftStart,zone:d.zone,...(rotation?{rotation}:{})};
}
export function ruleAt(rules:CapacityRule[],scopes:string[],day:string){for(const scope of [...new Set(['org',...scopes])].reverse()){const rule=rules.filter(r=>r.scope===scope&&r.effectiveFrom<=day).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];if(rule)return rule;}return null;}
export const overlap=(a:Span,b:Span)=>a.start<b.end&&b.start<a.end;
export function mergeSpans(input:Span[]):Span[]{const out:Span[]=[];for(const s of input.filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start).sort((a,b)=>a.start-b.start)){const last=out.at(-1);if(last&&s.start<=last.end)last.end=Math.max(last.end,s.end);else out.push({...s});}return out;}
export function subtractSpans(input:Span[],exclusions:Span[]):Span[]{let result=mergeSpans(input);for(const x of mergeSpans(exclusions))result=result.flatMap(s=>!overlap(s,x)?[s]:[{start:s.start,end:Math.min(s.end,x.start)},{start:Math.max(s.start,x.end),end:s.end}].filter(a=>a.end>a.start));return result;}
export const spanHours=(spans:Span[])=>mergeSpans(spans).reduce((a,s)=>a+(s.end-s.start)/3600000,0);
function localInstant(day:string,time:string,zone:string){const [h,m]=time.split(':').map(Number),wall=Date.parse(day+'T00:00:00Z')+(h*60+m)*60000;const observed=(at:number)=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(at)),n=(k:string)=>Number(p.find(x=>x.type===k)?.value);return Date.UTC(n('year'),n('month')-1,n('day'),n('hour'),n('minute'));};let at=midnight(day,zone)+(h*60+m)*60000;for(let i=0;i<3;i++)at+=wall-observed(at);return observed(at)===wall?at:NaN;}
export function shift(day:string,c:Capacity):Span|null{
 let time=c.shiftStart,hours=c.hoursPerDay;
 if(c.rotation){const i=Math.round((Date.parse(day)-Date.parse(c.rotation.anchor))/86400000),slot=c.rotation.slots[((i%c.rotation.slots.length)+c.rotation.slots.length)%c.rotation.slots.length];if(!slot)return null;time=slot.start;hours=slot.hours;}
 else if(!c.days.includes(new Date(day+'T00:00:00Z').getUTCDay()))return null;
 const start=localInstant(day,time,c.zone);if(!Number.isFinite(start))return null;return {start,end:start+hours*3600000};
}
const clip=(s:Span,b:Span)=>({start:Math.max(s.start,b.start),end:Math.min(s.end,b.end)});
export function availability(rules:CapacityRule[],scopes:string[],from:string,through:string,leave:{start:string;end:string}[],overtime:Span[]=[],adjustments:CalendarAdjustment[]=[]){
 if(!validDay(from)||!validDay(through)||from>through||(Date.parse(through)-Date.parse(from))>92*86400000)throw Error('Choose a reporting range of up to 93 days.');
 let missing=0,loadable=0,approvedOvertimeHours=0;const scheduled:Span[]=[],net:Span[]=[];
 const applicable=adjustments.filter(a=>a.status==='approved'&&['org',...scopes].includes(a.scope)),extras=[...overtime,...applicable.filter(a=>a.kind==='overtime').map(a=>({start:Date.parse(a.start),end:Date.parse(a.end)}))],absences=applicable.filter(a=>a.kind==='unavailable').map(a=>({start:Date.parse(a.start),end:Date.parse(a.end)}));
 for(let day=from;day<=through;day=dateAdd(day,1)){
  const r=ruleAt(rules,scopes,day);if(!r){missing++;continue;}const c=r.values,dayStart=midnight(day,c.zone),dayEnd=midnight(dateAdd(day,1),c.zone),bounds={start:dayStart,end:dayEnd};
  const prevDay=dateAdd(day,-1),prev=ruleAt(rules,scopes,prevDay),shifts=[shift(day,c),prev?shift(prevDay,prev.values):null].filter((s):s is Span=>!!s).map(s=>clip(s,bounds)),base=mergeSpans(shifts);scheduled.push(...base);
  const holiday=applicable.some(a=>a.kind==='holiday'&&validDay(a.start)&&validDay(a.end)&&a.start<=day&&a.end>=day),onLeave=leave.some(l=>validDay(l.start)&&validDay(l.end)&&l.start<=day&&l.end>=day);
  // Holidays remove contractual shifts; explicit approved overtime can restore capacity, never booked leave/unavailability.
  const additional=extras.map(x=>clip(x,bounds)),gross=mergeSpans([...(holiday?[]:base),...additional]),n=onLeave?[]:subtractSpans(gross,absences);
  net.push(...n);loadable+=spanHours(n)*c.loadingPercent/100;approvedOvertimeHours+=spanHours(subtractSpans(n,holiday?[]:base));
 }
 return {scheduled:mergeSpans(scheduled),net:mergeSpans(net),grossHours:spanHours(scheduled),netHours:spanHours(net),approvedOvertimeHours,loadableHours:Math.min(loadable,spanHours(net)),missingDays:missing};
}
export const percent=(n:number,d:number)=>d>0?100*n/d:null;
export function covered(span:Span,available:Span[]){return mergeSpans(available).some(x=>x.start<=span.start&&x.end>=span.end);}
export function inZoneDay(at:number,zone:string){return localDay(at,zone);}
