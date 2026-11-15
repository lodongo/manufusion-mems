import {midnight,localDay} from './maintenanceAnalyticsCalendar';
import {dateAdd} from './maintenanceAnalyticsCore';
export type Span={start:number;end:number};
export type Capacity={hoursPerDay:number;days:number[];loadingPercent:number;shiftStart:string;zone:string};
export type CapacityRule={scope:string;effectiveFrom:string;values:Capacity};
export const validDay=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export function validateCapacity(raw:unknown):Capacity{
 const d=raw as Partial<Capacity>;if(!d||typeof d!=='object'||typeof d.hoursPerDay!=='number'||!Number.isFinite(d.hoursPerDay)||d.hoursPerDay<=0||d.hoursPerDay>24||!Array.isArray(d.days)||!d.days.length||d.days.some(x=>!Number.isInteger(x)||x<0||x>6)||new Set(d.days).size!==d.days.length||typeof d.loadingPercent!=='number'||!Number.isFinite(d.loadingPercent)||d.loadingPercent<0||d.loadingPercent>100||typeof d.shiftStart!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.shiftStart)||typeof d.zone!=='string')throw Error('Enter valid shift hours, working days, target loading and timezone.');
 new Intl.DateTimeFormat('en',{timeZone:d.zone});return {hoursPerDay:d.hoursPerDay,days:[...d.days].sort(),loadingPercent:d.loadingPercent,shiftStart:d.shiftStart,zone:d.zone};
}
export function ruleAt(rules:CapacityRule[],scopes:string[],day:string){for(const scope of [...new Set(['org',...scopes])].reverse()){const rule=rules.filter(r=>r.scope===scope&&r.effectiveFrom<=day).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];if(rule)return rule;}return null;}
export const overlap=(a:Span,b:Span)=>a.start<b.end&&b.start<a.end;
export function mergeSpans(input:Span[]):Span[]{const out:Span[]=[];for(const s of input.filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start).sort((a,b)=>a.start-b.start)){const last=out.at(-1);if(last&&s.start<=last.end)last.end=Math.max(last.end,s.end);else out.push({...s});}return out;}
export function subtractSpans(input:Span[],exclusions:Span[]):Span[]{let result=mergeSpans(input);for(const x of mergeSpans(exclusions))result=result.flatMap(s=>!overlap(s,x)?[s]:[{start:s.start,end:Math.min(s.end,x.start)},{start:Math.max(s.start,x.end),end:s.end}].filter(a=>a.end>a.start));return result;}
export const spanHours=(spans:Span[])=>mergeSpans(spans).reduce((a,s)=>a+(s.end-s.start)/3600000,0);
export function shift(day:string,c:Capacity):Span|null{if(!c.days.includes(new Date(day+'T00:00:00Z').getUTCDay()))return null;const [h,m]=c.shiftStart.split(':').map(Number);const start=midnight(day,c.zone)+(h*60+m)*60000;return {start,end:start+c.hoursPerDay*3600000};}
export function availability(rules:CapacityRule[],scopes:string[],from:string,through:string,leave:{start:string;end:string}[],overtime:Span[]=[]){
 if(!validDay(from)||!validDay(through)||from>through||(Date.parse(through)-Date.parse(from))>92*86400000)throw Error('Choose a reporting range of up to 93 days.');
 let missing=0,loadable=0;const scheduled:Span[]=[],net:Span[]=[];const exclusions:Span[]=[];
 for(let day=from;day<=through;day=dateAdd(day,1)){const r=ruleAt(rules,scopes,day);if(!r){missing++;continue;}const c=r.values,s=shift(day,c),dayStart=midnight(day,c.zone),dayEnd=midnight(dateAdd(day,1),c.zone);const extra=overtime.flatMap(x=>{const start=Math.max(x.start,dayStart),end=Math.min(x.end,dayEnd);return end>start?[{start,end}]:[]});const gross=mergeSpans([...(s?[s]:[]),...extra]);scheduled.push(...(s?[s]:[]));const leaveSpans=leave.filter(l=>validDay(l.start)&&validDay(l.end)&&l.start<=day&&l.end>=day).map(()=>({start:dayStart,end:dayEnd}));exclusions.push(...leaveSpans);const n=subtractSpans(gross,leaveSpans);net.push(...n);loadable+=spanHours(n)*c.loadingPercent/100;}
 const clean=subtractSpans(net,exclusions);
 return {scheduled:mergeSpans(scheduled),net:clean,grossHours:spanHours(scheduled),netHours:spanHours(clean),loadableHours:Math.min(loadable,spanHours(clean)),missingDays:missing};
}
export const percent=(n:number,d:number)=>d>0?100*n/d:null;
export function covered(span:Span,available:Span[]){return mergeSpans(available).some(x=>x.start<=span.start&&x.end>=span.end);}
export function inZoneDay(at:number,zone:string){return localDay(at,zone);}
