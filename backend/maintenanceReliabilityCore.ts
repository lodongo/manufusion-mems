export type Failure={id:string;orderCode:string;startedAt:string;restoredAt:string;repairHours:number|null;mode:string;strategy:string};
export type Observation={from:string;through:string;plannedHours:number;operatingHours:number;failures:Failure[];status:string};
const finite=(x:number)=>Number.isFinite(x)&&x>=0;
export function validateObservation(o:Observation,start:number,end:number){
 if(!finite(o.plannedHours)||!finite(o.operatingHours)||o.operatingHours>o.plannedHours||o.plannedHours>(end-start)/3600000+1e-6)throw Error('Operating hours must not exceed planned hours or the reporting interval.');
 const seen=new Set<string>(),sorted=[...o.failures].sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt));let stop=start,loss=0;
 for(const f of sorted){const a=Date.parse(f.startedAt),b=Date.parse(f.restoredAt);if(!f.id||seen.has(f.id)||!Number.isFinite(a)||!Number.isFinite(b)||a<start||b>end||a<stop||b<=a)throw Error('Each failure must be unique, nonoverlapping and entirely inside the observation.');seen.add(f.id);stop=b;const downtime=(b-a)/3600000;loss+=downtime;if(f.repairHours!==null&&(!finite(f.repairHours)||f.repairHours>downtime+1e-6))throw Error('Active repair time cannot exceed the failure/restoration interval.');}
 if(loss>o.plannedHours-o.operatingHours+1e-6)throw Error('Verified failure downtime cannot exceed planned non-operating time.');return o;
}
export function reliabilityMetrics(obs:Observation[],from:string,through:string){
 const eligible=obs.filter(o=>o.status==='approved'&&o.from>=from&&o.through<=through).sort((a,b)=>a.from.localeCompare(b.from));const bump=(d:string)=>new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 let cursor=from,complete=eligible.length>0;for(const o of eligible){if(o.from!==cursor)complete=false;cursor=bump(o.through);}complete=complete&&cursor===bump(through);
 const planned=eligible.reduce((n,o)=>n+o.plannedHours,0),operating=eligible.reduce((n,o)=>n+o.operatingHours,0),failures=eligible.flatMap(o=>o.failures),repair=failures.filter(f=>f.repairHours!==null),downtime=failures.reduce((n,f)=>n+(Date.parse(f.restoredAt)-Date.parse(f.startedAt))/3600000,0);
 const modes=new Map<string,{mode:string;count:number;hours:number}>();for(const f of failures){const key=f.mode||'Unclassified',v=modes.get(key)||{mode:key,count:0,hours:0};v.count++;v.hours+=(Date.parse(f.restoredAt)-Date.parse(f.startedAt))/3600000;modes.set(key,v);}
 return {coveredIntervals:eligible.length,complete,plannedHours:eligible.length?planned:null,operatingHours:eligible.length?operating:null,failures:eligible.length?failures.length:null,failureDowntime:eligible.length?downtime:null,mtbf:complete&&operating>0&&failures.length>0?operating/failures.length:null,mttr:complete&&failures.length>0&&repair.length===failures.length?repair.reduce((n,f)=>n+f.repairHours!,0)/repair.length:null,meanRestore:complete&&failures.length?downtime/failures.length:null,availability:complete&&planned>0?100*operating/planned:null,modes:[...modes.values()].sort((a,b)=>b.hours-a.hours),repeatModes:[...modes.values()].filter(v=>v.count>1)};
}
