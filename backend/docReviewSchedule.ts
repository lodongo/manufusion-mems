/** Calendar-month document review scheduling, with leap-day and month-end clamping. */
export function nextReviewDate(publishedAt:string,months:number):string|null{
 const start=new Date(publishedAt);
 if(!Number.isFinite(start.getTime())||!Number.isInteger(months)||months<1||months>120)return null;
 const y=start.getUTCFullYear(),m=start.getUTCMonth()+months;
 const year=y+Math.floor(m/12),month=((m%12)+12)%12;
 const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
 const day=Math.min(start.getUTCDate(),last);
 return new Date(Date.UTC(year,month,day)).toISOString().slice(0,10);
}
export function reviewState(date:string|null,today:string):'not_scheduled'|'overdue'|'due_soon'|'current'{
 if(!date)return 'not_scheduled';
 if(date<today)return 'overdue';
 const delta=(Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000;
 return delta<=30?'due_soon':'current';
}
