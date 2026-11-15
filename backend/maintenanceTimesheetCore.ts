import {mergeSpans,subtractSpans,spanHours,percent,type Span} from './maintenanceCapacityCore';
export type SheetEntry={id:string;start:string;end:string;status:string;classCode:string;classification:string;productive:boolean;deductible:boolean;delayOwner:string};
const clip=(a:Span,b:Span)=>({start:Math.max(a.start,b.start),end:Math.min(a.end,b.end)});
export function reconcileDay(net:Span[],bounds:Span,entries:SheetEntry[],now:number){
 const observed={start:bounds.start,end:Math.min(bounds.end,now)},effective=net.map(s=>clip(s,observed)),approved=(e:SheetEntry)=>['approved','recorded'].includes(e.status),span=(e:SheetEntry)=>clip({start:Date.parse(e.start),end:Date.parse(e.end)},observed);
 const included=entries.filter(e=>approved(e)&&span(e).end>span(e).start),excluded=entries.filter(e=>!approved(e)&&!['superseded','void'].includes(e.status)&&Date.parse(e.start)<observed.end&&(e.end?Date.parse(e.end):now)>observed.start);
 const deduction=included.filter(e=>e.deductible).map(span),available=subtractSpans(effective,deduction),work=included.filter(e=>!e.deductible),all=mergeSpans(work.map(span)),inside=mergeSpans(all.flatMap(x=>available.map(y=>clip(x,y))));
 const byClass:Record<string,{label:string;hours:number;delayOwner:string}>={};for(const e of included){const key=e.classCode+'|'+e.classification+'|'+e.delayOwner,b=byClass[key]||{label:e.classification||e.classCode,hours:0,delayOwner:e.delayOwner};b.hours+=spanHours([span(e)]);byClass[key]=b;}
 const direct=spanHours(work.filter(e=>e.classCode==='DIRECT').map(span)),productive=spanHours(work.filter(e=>e.productive).map(span)),accounted=spanHours(inside),netHours=spanHours(available),total=spanHours(all);
 return {netHours,directHours:direct,productiveHours:productive,accountedHours:accounted,bookedHours:total,unaccountedHours:Math.max(0,netHours-accounted),outsideCapacityHours:Math.max(0,total-accounted),deductedHours:spanHours(effective)-netHours,utilization:percent(direct,netHours),accountability:percent(accounted,netHours),pendingCount:excluded.length,classes:Object.values(byClass),hasTime:included.length>0};
}
