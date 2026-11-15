import {getDoc,HttpError,str,type Obj} from './core';
import type {OrgContext} from './guards';
/** The exact marked maintenance types. Do not infer from localized labels. */
export const NEXT_CYCLE_TYPES=['MAI-001','MAI-002','MAI-003','MAI-004','MAI-008','MAI-009','MAI-010','MAI-011','MAI-013','MAI-014','MAI-015'] as const;
export const cycleRestricted=(type:string)=>NEXT_CYCLE_TYPES.some(c=>c===type);
export const cyclePath=(org:string)=>'organizations/'+org+'/maintenance_work_group_settings/cycle';
export const validZone=(v:string)=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return !!v;}catch{return false;}};
export function localDate(at:Date,zone:string):string{
 const part=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
 return ['year','month','day'].map(k=>part.find(p=>p.type===k)?.value||'').join('-');
}
export function nextCycleStart(today:string,startDay:number):string{
 const d=new Date(today+'T00:00:00Z');const offset=(d.getUTCDay()-startDay+7)%7;
 d.setUTCDate(d.getUTCDate()+7-offset);return d.toISOString().slice(0,10);
}
export async function getMaintenanceCycle(ctx:OrgContext,now=new Date()){
 const doc=await getDoc(cyclePath(ctx.orgId));
 const day=Number(doc?.data.startDay??1),candidate=str(doc?.data.timeZone)||str(ctx.org.data.timeZone)||str(ctx.org.data.timezone)||'UTC',timeZone=validZone(candidate)?candidate:'UTC';
 const startDay=Number.isInteger(day)&&day>=0&&day<=6?day:1,today=localDate(now,timeZone);
 return {version:Number(doc?.data.version)||0,startDay,timeZone,today,nextStart:nextCycleStart(today,startDay),restrictedTypes:[...NEXT_CYCLE_TYPES]};
}
function validDate(s:string){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
export function validateCycleDates(type:string,start:string,end:string,cycle:{today:string;nextStart:string},existing?:Obj){
 if(!type)throw new HttpError(400,'Choose maintenance type.');
 if(!validDate(start)||!validDate(end))throw new HttpError(400,'Enter valid start date and end date.');
 if(end<start)throw new HttpError(400,'End date cannot be before start date.');
 if(Date.parse(end)-Date.parse(start)>366*86400000)throw new HttpError(400,'A Work Order can span at most one year.');
 // A previously admitted job must not become invalid merely because its cycle arrived.
 const newAdmission=!existing||start!==str(existing.scheduledStart)||cycleRestricted(type)&&!cycleRestricted(str(existing.maintenanceTypeCode));
 if(newAdmission&&start<cycle.today)throw new HttpError(400,'Start date cannot be in the past.');
 if(newAdmission&&cycleRestricted(type)&&start<cycle.nextStart)throw new HttpError(400,'This maintenance type must start in the next maintenance cycle or later: '+cycle.nextStart+'.');
}
