import {overlap,type Span} from './maintenanceCapacityCore';
export type TimeBooking={uid:string;start:string;end:string;status:string};
export const TIME_CLASSES=[
 {code:'DIRECT',label:'Direct maintenance execution',productive:true,requiresOrder:true},
 {code:'SUPPORT',label:'Operational support',productive:true,requiresOrder:false},
 {code:'TRAINING',label:'Training / meetings',productive:false,requiresOrder:false},
 {code:'WAITING',label:'Waiting / delays',productive:false,requiresOrder:false},
 {code:'UNALLOCATED',label:'Unallocated time',productive:false,requiresOrder:false},
 {code:'OTHER',label:'Other accountable time',productive:false,requiresOrder:false}
] as const;
export function bookingSpan(b:TimeBooking,now:number):Span{const start=Date.parse(b.start);return {start,end:b.end?Date.parse(b.end):Math.max(now,start+1)};}
export function timeConflict(bookings:TimeBooking[],uid:string,span:Span,now:number){return bookings.some(b=>b.uid===uid&&!['superseded','void'].includes(b.status)&&overlap(span,bookingSpan(b,now)));}
export function bookedHours(bookings:TimeBooking[],span:Span,now:number){return bookings.filter(b=>['recorded','approved'].includes(b.status)).reduce((n,b)=>{const v=bookingSpan(b,now);return n+Math.max(0,Math.min(span.end,v.end)-Math.max(span.start,v.start))/3600000},0);}
