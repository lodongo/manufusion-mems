import {dateAdd} from './maintenanceAnalyticsCore';
export type Calendar={id:string;name:string;zone:string;weekEndDay:number;years:{fy:number;label:string;start:string;end:string;periods:{no:number;name:string;start:string;end:string;special:boolean}[]}[]};
export const PERIODS=['today','yesterday','current_week','last_week','current_month','last_month','current_year','last_year','custom'] as const;
export type PeriodChoice=typeof PERIODS[number];
export function localDay(ms:number,zone:string){const p=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));return ['year','month','day'].map(k=>p.find(x=>x.type===k)?.value).join('-');}
export function midnight(date:string,zone:string){
 const guess=Date.parse(date+'T00:00:00Z');
 function offset(at:number){const p=new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(at));const n=(k:string)=>Number(p.find(x=>x.type===k)?.value);return Date.UTC(n('year'),n('month')-1,n('day'),n('hour'),n('minute'),n('second'))-at;}
 let at=guess-offset(guess);at=guess-offset(at);return at;
}
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export function periodBounds(choice:PeriodChoice,calendar:Calendar,now:number,customStart='',customEnd=''){
 const today=localDay(now,calendar.zone);let start='',end='',label='';
 const fy=calendar.years.find(y=>y.start<=today&&y.end>=today);
 const periods=calendar.years.flatMap(y=>y.periods.filter(p=>!p.special).map(p=>({...p,fy:y.fy}))).sort((a,b)=>a.start.localeCompare(b.start));
 if(choice==='custom'){if(!validDate(customStart)||!validDate(customEnd)||customStart>customEnd)throw Error('Enter a valid custom date range.');start=customStart;end=customEnd;label='Custom date range';}
 else if(choice==='today'||choice==='yesterday'){start=choice==='today'?today:dateAdd(today,-1);end=start;label=choice==='today'?'Today':'Yesterday';}
 else if(choice==='current_week'||choice==='last_week'){
  if(!fy)throw Error('No generated financial year covers today. Configure the Legal Entity financial calendar.');
  const weekStart=(calendar.weekEndDay+1)%7,weekday=new Date(today+'T00:00:00Z').getUTCDay(),thisStart=dateAdd(today,-((weekday-weekStart+7)%7));start=choice==='last_week'?dateAdd(thisStart,-7):thisStart;end=dateAdd(start,6);label=choice==='last_week'?'Last financial week':'Current financial week';
 }else if(choice==='current_month'||choice==='last_month'){
  const i=periods.findIndex(p=>p.start<=today&&p.end>=today),period=periods[i-(choice==='last_month'?1:0)];
  if(i<0||!period)throw Error('The required financial period is not generated.');start=period.start;end=period.end;label='FY '+period.fy+' · '+period.name;
 }else{
  const y=choice==='current_year'?fy:calendar.years.filter(y=>y.end<(fy?.start||today)).sort((a,b)=>b.end.localeCompare(a.end))[0];
  if(!y)throw Error('The required financial year is not generated.');start=y.start;end=y.end;label=y.label;
 }
 const lo=midnight(start,calendar.zone),hi=midnight(dateAdd(end,1),calendar.zone),cut=Math.min(now+1,hi);
 if(lo>=cut||hi-lo>370*86400000+7200000)throw Error('Select a past or current range of up to one financial year.');
 return {start:lo,end:cut,startDate:start,endDate:end,label,zone:calendar.zone,plannedEnd:hi};
}
export function trendBuckets(w:ReturnType<typeof periodBounds>,choice:PeriodChoice,calendar:Calendar){
 const out:{start:number;end:number;label:string}[]=[];
 const days=(Date.parse(w.endDate)-Date.parse(w.startDate))/86400000+1;
 if(days<=2||w.end-w.start<=2*86400000){for(let t=w.start;t<w.end;t+=3600000)out.push({start:t,end:Math.min(w.end,t+3600000),label:new Intl.DateTimeFormat('en-GB',{timeZone:w.zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t))});return out;}
 if(choice==='current_year'||choice==='last_year'){
  for(const p of calendar.years.flatMap(y=>y.periods.filter(p=>!p.special)).sort((a,b)=>a.start.localeCompare(b.start))){
   const a=Math.max(w.start,midnight(p.start,w.zone)),b=Math.min(w.end,midnight(dateAdd(p.end,1),w.zone));if(a<b)out.push({start:a,end:b,label:p.name});
  }if(out.length)return out;
 }
 const step=days>14?7:1;let d=w.startDate;
 while(midnight(d,w.zone)<w.end){const a=Math.max(w.start,midnight(d,w.zone)),b=Math.min(w.end,midnight(dateAdd(d,step),w.zone));if(a<b)out.push({start:a,end:b,label:d.slice(5)});d=dateAdd(d,step);}
 return out;
}
