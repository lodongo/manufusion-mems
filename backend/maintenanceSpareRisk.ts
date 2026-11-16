export type RiskTone='green'|'yellow'|'red';
export const addCalendarDays=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export const daysBetween=(a:string,b:string)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
export function configuredDays(v:unknown):number|null{if(v===null||v===undefined||v===''||typeof v==='boolean')return null;const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=3650?n:null;}
export function leadStats(values:number[]){const v=values.filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);const round=(n:number)=>Math.round(n*10)/10;return {count:v.length,min:v.length?round(v[0]):null,mean:v.length?round(v.reduce((a,b)=>a+b,0)/v.length):null,p90:v.length?round(v[Math.ceil(v.length*.9)-1]):null,max:v.length?round(v[v.length-1]):null};}
export function spareRisk(input:{today:string;expectedStart:string;required:number;available:number|null;supplierDays:number|null;internalDays:number|null}){
 const {today,expectedStart,required,available,supplierDays,internalDays}=input;
 const shortage=available===null?null:Math.max(0,Math.round((required-available)*1e6)/1e6);
 if(shortage===0)return {shortage,delivery:null,proposedStart:expectedStart||null,delayDays:0,tone:'green' as RiskTone,reason:'Sufficient usable stock at analysis time'};
 if(shortage===null||supplierDays===null||internalDays===null||!expectedStart)return {shortage,delivery:null,proposedStart:null,delayDays:null,tone:'red' as RiskTone,reason:shortage===null?'Usable stock could not be verified':supplierDays===null?'Supplier lead time not configured':internalDays===null?'Internal lead time unavailable':'Expected start date unavailable'};
 const delivery=addCalendarDays(today,Math.ceil(supplierDays+internalDays)),latestStart=addCalendarDays(delivery,7);
 const proposedStart=delivery<=expectedStart?expectedStart:addCalendarDays(delivery,1);
 const delayDays=Math.max(0,daysBetween(expectedStart,proposedStart)),slack=daysBetween(delivery,expectedStart);
 return {shortage,delivery,latestStart,proposedStart,delayDays,tone:(delayDays>0?'red':slack<=7?'yellow':'green') as RiskTone,reason:delayDays>0?'Delivery forecast exceeds the expected start':slack<=7?'Delivery within seven days of the expected start':'Delivery forecast before expected start'};
}
export function combineSpareRisk(rows:{tone:RiskTone;proposedStart:string|null;delivery:string|null;shortage:number|null}[],expectedStart:string){
 const unknown=rows.some(r=>r.shortage===null||r.shortage>0&&!r.delivery),deliveries=rows.map(r=>r.delivery).filter((d):d is string=>!!d).sort(),worstDelivery=deliveries.at(-1)||null,proposals=rows.map(r=>r.proposedStart).filter((d):d is string=>!!d).sort(),knownStart=proposals.at(-1)||expectedStart||null;
 const proposedStart=unknown?null:knownStart;
 return {unknown,worstDelivery,knownStart,proposedStart,delayDays:proposedStart&&expectedStart?Math.max(0,daysBetween(expectedStart,proposedStart)):null,tone:(rows.some(r=>r.tone==='red')?'red':rows.some(r=>r.tone==='yellow')?'yellow':'green') as RiskTone};
}
