/** Read-only reporting on explicit event timestamps. Unknown historical state is never inferred. */
export type Kind='wr'|'wo';
export type RecordData=Record<string,unknown>;
export type HistoryEvent={from:string;to:string;at:string;by?:string;byName?:string;source?:string;reason?:string;policyVersion?:number|null};
export type RecordInput={id:string;kind:Kind;data:RecordData};
export type Interval={start:number;end:number};
const obj=(v:unknown):RecordData=>v&&typeof v==='object'&&!Array.isArray(v)?v as RecordData:{};
const str=(v:unknown)=>typeof v==='string'?v:'';
const arr=(v:unknown)=>Array.isArray(v)?v.map(obj):[];
const ms=(v:unknown)=>Date.parse(str(v));
export const ratio=(n:number,d:number)=>d>0?100*n/d:null;
export const terminal=(kind:Kind,state:string)=>kind==='wr'?['confirmed','converted','closed','cancelled','declined'].includes(state):['WO900','WO990'].includes(state);
const normalize=(kind:Kind,state:string)=>kind==='wr'?(state==='approved'?'submitted':state==='rejected'?'declined':state):state;
export function requestTransition(d:RecordData,to:string,at:string,by:string,byName:string,source:string,reason=''){
 const from=normalize('wr',str(d.status)),target=normalize('wr',to);
 if(!target||target===from)return {};
 const version=obj(d.maintenanceGovernance).version;
 return {analyticsTransitions:[...arr(d.analyticsTransitions),{from,to:target,at,by,byName,source,reason,policyVersion:typeof version==='number'?version:null}]};
}
export function requestTransitionInitial(d:RecordData,at:string,by:string,byName:string){
 return requestTransition({...d,status:''},'created',at,by,byName,'request_created');
}
export type Point={at:number;state:string;observed:boolean};
export type Timeline={created:number;points:Point[];coverageStart:number|null;current:string;terminalAt:number|null;kind:Kind;id:string;data:RecordData};
export function timeline(r:RecordInput,now:number):Timeline{
 const d=r.data,kind=r.kind,created=ms(d.createdAt||d.requestedAt),raw=kind==='wr'?arr(d.analyticsTransitions):arr(d.workflowTransitions);
 const current=kind==='wr'?(d.status==='to_be_assessed'&&str(d.woCode)?'converted':normalize(kind,str(d.status))):d.status==='closed'?'WO900':d.status==='cancelled'?'WO990':str(d.workflowCode)||'UNKNOWN';
 const points:Point[]=raw.flatMap(t=>{
  const at=ms(t.at),state=normalize(kind,str(t.to));
  return Number.isFinite(at)&&at<=now&&(!Number.isFinite(created)||at>=created)&&state?[{at,state,observed:true}]:[];
 }).sort((a,b)=>a.at-b.at);
 // Explicit terminal event field: not the last generic update timestamp.
 if(terminal(kind,current)&&!points.some(p=>p.state===current)){
  const field=kind==='wo'?(current==='WO900'?d.closedAt:d.cancelledAt):current==='confirmed'||current==='converted'?(d.analyticsConvertedAt||d.convertedAt||obj(d.requestApproval).decidedAt):d.closedAt;
  const at=ms(field);
  if(Number.isFinite(at)&&at<=now&&(!Number.isFinite(created)||at>=created))points.push({at,state:current,observed:true});
 }
 points.sort((a,b)=>a.at-b.at);
 const uniq=points.filter((p,i)=>i===0||p.state!==points[i-1].state);
 const coverageStart=uniq.length?uniq[0].at:null;
 // Live snapshots may be displayed but do not retroactively fill historical intervals.
 const last=uniq.at(-1);
 if(current!=='UNKNOWN'&&last?.state!==current)uniq.push({at:now,state:current,observed:false});
 const end=uniq.filter(p=>p.observed&&terminal(kind,p.state)).at(-1)?.at??null;
 return {created,points:uniq,coverageStart,current,terminalAt:end,kind,id:r.id,data:d};
}
export function stateAt(t:Timeline,at:number):string|null{
 if(!Number.isFinite(t.created)||t.created>at)return null;
 const p=t.points.filter(x=>x.at<=at).at(-1);
 return p?.state||'UNKNOWN';
}
export type Metric='created'|'converted'|'closed'|'cancelled'|'backlog'|'opening'|'overdue'|'cohort'|'unknown'|'all';
export function events(t:Timeline,w:Interval){
 const inWindow=(n:number)=>n>=w.start&&n<w.end;
 const end=stateAt(t,w.end-1),opening=stateAt(t,w.start-1);
 const event=t.points.filter(p=>p.observed&&inWindow(p.at));
 const isConverted=(s:string)=>['confirmed','converted'].includes(s);
 const conversion=t.kind==='wr'&&event.some(p=>isConverted(p.state));
 const closed=event.some(p=>t.kind==='wr'?p.state==='closed':p.state==='WO900');
 const cancelled=event.some(p=>t.kind==='wr'?['cancelled','declined'].includes(p.state):p.state==='WO990');
 const created=inWindow(t.created);
 const cohort=t.kind==='wr'&&created&&!!end&&isConverted(end);
 const backlog=!!end&&end!=='UNKNOWN'&&!terminal(t.kind,end);
 const openingBacklog=!!opening&&opening!=='UNKNOWN'&&!terminal(t.kind,opening);
 return {created,converted:conversion,closed,cancelled,backlog,opening:openingBacklog,cohort,unknown:end==='UNKNOWN',end,openingState:opening,terminalEvents:event.filter(p=>terminal(t.kind,p.state)).length};
}
export function dwell(t:Timeline,w:Interval):Array<{state:string;hours:number}>{
 if(!Number.isFinite(t.created)||t.created>=w.end)return [];
 const result=new Map<string,number>();
 const boundaries=[...new Set([Math.max(w.start,t.created),...t.points.filter(p=>p.observed&&p.at>=w.start&&p.at<w.end).map(p=>p.at),w.end])].sort((a,b)=>a-b);
 for(let i=0;i<boundaries.length-1;i++){
  const start=boundaries[i],end=boundaries[i+1],state=stateAt(t,start);
  if(state&&!terminal(t.kind,state))result.set(state,(result.get(state)||0)+(end-start)/3600000);
 }
 return [...result].map(([state,hours])=>({state,hours}));
}
export function summarize(ts:Timeline[],w:Interval,now:number,due:(d:RecordData)=>number){
 let created=0,converted=0,closed=0,cancelled=0,backlog=0,opening=0,cohort=0,unknown=0,unknownOpening=0,overdue=0,missingDue=0,turnaroundHours=0,turnaroundN=0,scheduledCompleted=0,onTime=0,undated=0,unknownEvent=0;
 const states=new Map<string,number>(),age=new Map<string,number>(),durations=new Map<string,number>(),live=new Map<string,number>();
 const rows=ts.map(t=>{
  const e=events(t,w),dueAt=due(t.data);
  if(!Number.isFinite(t.created))undated++;
  if(t.current!=='UNKNOWN'&&terminal(t.kind,t.current)&&t.terminalAt===null)unknownEvent++;
  if(e.created)created++;if(e.converted)converted++;if(e.closed)closed++;if(e.cancelled)cancelled++;if(e.backlog)backlog++;if(e.opening)opening++;if(e.cohort)cohort++;if(e.unknown)unknown++;if(e.openingState==='UNKNOWN')unknownOpening++;
  if(e.end)states.set(e.end,(states.get(e.end)||0)+1);
  if(Number.isFinite(t.created)&&t.created<=now)live.set(t.current,(live.get(t.current)||0)+1);
  const pastDue=e.backlog&&Number.isFinite(dueAt)&&dueAt<w.end-1;
  if(pastDue)overdue++;if(e.backlog&&!Number.isFinite(dueAt))missingDue++;
  if(e.backlog){const days=(w.end-1-t.created)/86400000,key=days<1?'0–1 day':days<7?'1–7 days':days<30?'7–30 days':'30+ days';age.set(key,(age.get(key)||0)+1);}
  if((e.converted||e.closed)&&t.terminalAt!==null&&Number.isFinite(t.created)&&t.terminalAt>=t.created){turnaroundHours+=(t.terminalAt-t.created)/3600000;turnaroundN++;}
  if(t.kind==='wo'&&e.closed&&t.terminalAt!==null&&Number.isFinite(dueAt)){scheduledCompleted++;if(t.terminalAt<=dueAt)onTime++;}
  for(const v of dwell(t,w))durations.set(v.state,(durations.get(v.state)||0)+v.hours);
  return {t,e:{...e,overdue:pastDue}};
 });
 const counts=(m:Map<string,number>)=>[...m].map(([key,value])=>({key,value})).sort((a,b)=>b.value-a.value);
 return {metrics:{created,converted,closed,cancelled,backlog,opening,cohort,unknown,overdue,missingDue,cohortRate:ratio(cohort,created),throughputRate:ratio(converted,created),turnaroundHours:turnaroundN?turnaroundHours/turnaroundN:null,turnaroundN,scheduleCompliance:ratio(onTime,scheduledCompleted),scheduleSample:scheduledCompleted},coverage:{undated,unknownOpening,unknownClosing:unknown,unknownTerminalDate:unknownEvent,recordCount:ts.length},states:counts(states),liveStates:counts(live),age:counts(age),dwell:counts(durations),rows};
}
export function selectMetric(row:ReturnType<typeof summarize>['rows'][number],metric:Metric,state:string){
 return (metric==='all'||row.e[metric]===true)&&(!state||row.e.end===state);
}
export function dateAdd(date:string,days:number){const at=Date.parse(date+'T00:00:00Z');return new Date(at+days*86400000).toISOString().slice(0,10);}
