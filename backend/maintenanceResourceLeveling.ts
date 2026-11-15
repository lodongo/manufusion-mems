import {criticalPath,type ScheduleTask} from './maintenanceDomain';
import {mergeSpans,subtractSpans,type Span} from './maintenanceCapacityCore';
const intersection=(a:Span[],b:Span[])=>mergeSpans(a.flatMap(x=>b.map(y=>({start:Math.max(x.start,y.start),end:Math.min(x.end,y.end)}))));
/** Deterministic resource levelling. Offsets are earliest starts; physical duration, technical dependencies and team availability are hard constraints. */
export function levelResources(input:ScheduleTask[],windowHours:number,availability:Map<string,Span[]>){
 criticalPath(input);const placed=new Map<string,{start:number;finish:number}>(),remaining=new Map(input.map(t=>[t.id,t])),occupied=new Map<string,Span[]>(),out:ScheduleTask[]=[],conflicts:string[]=[];
 while(remaining.size){
  const ready=[...remaining.values()].filter(t=>t.dependencies.every(d=>placed.has(d)));
  if(!ready.length)throw Error('Unresolved schedule dependency.');
  const options=ready.map(t=>{const resources=[...new Set([...t.personnel.map(p=>'person:'+p),...t.tools.map(x=>'tool:'+x)])],earliest=Math.max(0,t.offset,...t.dependencies.map(d=>placed.get(d)!.finish));let fits:Span[]=[{start:earliest,end:windowHours}];fits=intersection(fits,availability.get(t.id)||[{start:0,end:windowHours}]);for(const r of resources)fits=subtractSpans(fits,occupied.get(r)||[]);const slot=fits.find(s=>s.end-s.start>=t.hours-1e-8);return {task:t,resources,earliest,start:slot?.start??Infinity};}).sort((a,b)=>a.start-b.start||(b.task.executionPriority||0)-(a.task.executionPriority||0)||a.task.id.localeCompare(b.task.id));
  const pick=options[0],t=pick.task;let start=pick.start;
  if(!Number.isFinite(start)){start=Math.max(pick.earliest,...pick.resources.flatMap(r=>(occupied.get(r)||[]).map(s=>s.end)));conflicts.push(t.description+': no continuous available team slot in this window.');}
  const finish=start+t.hours;placed.set(t.id,{start,finish});remaining.delete(t.id);
  for(const r of pick.resources){const entries=occupied.get(r)||[];entries.push({start,end:finish});occupied.set(r,entries);}
  out.push({...t,offset:start});
 }
 const result=criticalPath(out,windowHours);
 return {tasks:out,schedule:{...result,conflicts:[...new Set([...result.conflicts,...conflicts])]}};
}
