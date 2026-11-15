import {HttpError,getDoc,listDocs,isObj,str,nowIso,writeDoc,type Obj,type Doc} from './core';
import {orgRoute,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {outsideExecutionAccess} from './maintenanceWorkGroupPolicy';
import {entityOf,yearsOf} from './finCore';
import {timeline,summarize,events,selectMetric,type Kind,type Metric,type RecordInput,type RecordData} from './maintenanceAnalyticsCore';
import {PERIODS,periodBounds,trendBuckets,midnight,type Calendar,type PeriodChoice} from './maintenanceAnalyticsCalendar';
import {WO_STATES} from './maintenanceWorkflowState';
const texts=(v:unknown)=>Array.isArray(v)?v.map(str).filter(Boolean):[];
const rows=(v:unknown)=>Array.isArray(v)?v.filter(isObj):[];
const obj=(v:unknown)=>isObj(v)?v:{};
const validZone=(v:string)=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return !!v;}catch{return false;}};
const name=(d:Doc)=>str(d.data.name)||str(d.data.code)||d.id;
const labels:Record<string,string>={...Object.fromEntries(WO_STATES),UNKNOWN:'Unknown historical state',created:'Created',submitted:'Submitted',under_review:'Under review',approval_pending:'Awaiting request approval',returned:'Returned',closure_pending:'Closure pending',to_be_assessed:'Legacy assessment',confirmed:'Confirmed',converted:'Converted',closed:'Closed without confirmation',cancelled:'Cancelled',declined:'Declined'};
function enabled(ctx:OrgContext){if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'Maintenance is not enabled.');}
function employeeIds(d:RecordData,kind:Kind){return [...new Set([str(d.requestedBy),str(d.reviewerUid),str(d.reviewer),str(d.assessedBy),str(d.plannedBy),str(d.completedBy),...(kind==='wo'?[...rows(d.assignees).map(x=>str(x.uid)),...rows(d.timeLogs).map(x=>str(x.uid)),...Object.values(obj(d.taskExecution)).flatMap(e=>texts(obj(e).performers))]:[])].filter(Boolean))];}
async function analytics(ctx:OrgContext){
 enabled(ctx);const root='organizations/'+ctx.orgId,scope=await scopeOf(ctx);
 const [nodes,wr,wo]=await Promise.all([listDocs(root+'/structure'),listDocs(root+'/work_requests'),listDocs(root+'/work_orders')]);
 const all:RecordInput[]=[...wr.filter(d=>str(d.data.requestedBy)===ctx.uid||canAt(ctx,'MNT.view',texts(d.data.path),scope)).map(d=>({kind:'wr' as const,id:d.id,data:d.data})),...wo.filter(d=>canAt(ctx,'MNT.view',texts(d.data.path),scope)||outsideExecutionAccess(ctx.workGroupPolicy,d)).map(d=>({kind:'wo' as const,id:d.id,data:d.data}))];
 const nodeMap=new Map(nodes.map(n=>[n.id,n]));
 const allowedNodes=new Set(all.flatMap(r=>texts(r.data.path)));
 const legalId=(d:RecordData)=>texts(d.path).find(id=>nodeMap.get(id)?.data.level==='legal_entity')||'';
 const leIds=[...new Set(all.map(r=>legalId(r.data)).filter(Boolean))];
 const options=nodes.filter(n=>allowedNodes.has(n.id)).map(n=>({id:n.id,label:name(n),level:str(n.data.level),parentId:str(n.data.parentId),code:str(n.data.code)}));
 const groups=[...new Map(all.filter(r=>str(r.data.workGroupId)).map(r=>[str(r.data.workGroupId),{id:str(r.data.workGroupId),label:str(r.data.workGroupName)||str(r.data.workGroupCode)}])).values()];
 const peopleIds=new Set(all.flatMap(r=>employeeIds(r.data,r.kind)));
 // Only identities already visible on authorized records may appear in this report.
 const peopleMap=new Map<string,string>();for(const r of all){const d=r.data;for(const [id,n] of [[d.requestedBy,d.requestedByName],[d.reviewer,d.reviewerName],[d.reviewerUid,d.reviewAssignedName],[d.assessedBy,d.assessedByName],[d.plannedBy,d.plannedByName],[d.completedBy,d.completedByName],...rows(d.assignees).map(x=>[x.uid,x.name]),...rows(d.timeLogs).map(x=>[x.uid,x.name])])if(str(id)&&str(n))peopleMap.set(str(id),str(n));}
 const people=[...peopleIds].map(id=>({id,label:peopleMap.get(id)||id})).sort((a,b)=>a.label.localeCompare(b.label));
 const b=ctx.body,choice=(str(b.period)||'today') as PeriodChoice;if(!PERIODS.includes(choice))throw new HttpError(400,'Unknown reporting period.');
 const node=str(b.node),group=str(b.group),employee=str(b.employee),legal=str(b.legalEntity),asset=str(b.asset);
 const assets=[...new Map(all.filter(r=>str(r.data.assetTag)||str(r.data.unitId)).map(r=>{const id=str(r.data.assetTag)||str(r.data.unitId);return [id,{id,label:str(r.data.assetName)||str(r.data.unitName)||id}];})).values()];
 if(node&&!allowedNodes.has(node)||group&&!groups.some(g=>g.id===group)||employee&&!peopleIds.has(employee)||legal&&!leIds.includes(legal)||asset&&!assets.some(a=>a.id===asset))throw new HttpError(403,'Reporting scope is outside your accessible maintenance records.');
 const selected=all.filter(r=>(!node||texts(r.data.path).includes(node))&&(!group||r.data.workGroupId===group)&&(!employee||employeeIds(r.data,r.kind).includes(employee))&&(!legal||legalId(r.data)===legal)&&(!asset||(str(r.data.assetTag)||str(r.data.unitId))===asset));
 const selectedLE=[...new Set(selected.map(r=>legalId(r.data)).filter(Boolean))];
 const baseZone=str(ctx.org.data.timeZone)||str(ctx.org.data.timezone)||'UTC',zone=validZone(baseZone)?baseZone:'UTC';
 const now=Date.now(),customStart=str(b.start),customEnd=str(b.end);
 const calendars:Calendar[]=await Promise.all(selectedLE.map(async id=>{const [entity,years]=await Promise.all([entityOf(ctx.orgId,id),yearsOf(ctx.orgId,id)]);const n=nodeMap.get(id),z=str(obj(n?.data.attributes).timeZone)||str(n?.data.timeZone)||zone;return {id,name:n?name(n):id,zone:validZone(z)?z:zone,weekEndDay:entity.settings?.weekEndDay??-1,years:years.filter(y=>y.status==='active'||y.status==='closed').map(y=>({fy:y.fy,label:y.label,start:y.start,end:y.end,periods:y.periods.map(p=>({no:p.no,name:p.name,start:p.start,end:p.end,special:p.special}))}))};}));
 const general:Calendar={id:'',name:'Organization reporting timezone',zone,weekEndDay:6,years:[]};
 const base={options,groups,people,assets,legalEntities:leIds.map(id=>({id,label:nodeMap.has(id)?name(nodeMap.get(id)!):id})),stateLabels:labels,asOf:new Date(now).toISOString()};
 let window:ReturnType<typeof periodBounds>,calendar=calendars[0]||general,alignment='';
 try{
  if(choice==='custom'){calendar=general;window=periodBounds(choice,calendar,now,customStart,customEnd);alignment='Common explicit date interval in organization timezone; event times are UTC.';}
  else{
   if(!['today','yesterday'].includes(choice)&&(!calendars.length||selected.some(r=>!legalId(r.data))))throw Error('Choose a Legal Entity with a generated financial calendar, or use Custom dates.');
   if(['current_week','last_week'].includes(choice)&&calendars.some(c=>c.weekEndDay<0))throw Error('Financial week configuration is missing.');
   const bounds=(calendars.length?calendars:[general]).map(c=>periodBounds(choice,c,now,customStart,customEnd));
   window=bounds[0];
   if(bounds.some(w=>w.start!==window.start||w.plannedEnd!==window.plannedEnd))throw Error('Selected Legal Entities have different period or timezone boundaries. Choose one Legal Entity or a common Custom interval.');
   alignment=calendars.length>1?'Consolidated Legal Entities have identical interval boundaries.':calendar.name;
  }
 }catch(e){return {...base,blocked:e instanceof Error?e.message:'Invalid period',calendars:calendars.map(c=>({id:c.id,name:c.name,zone:c.zone})),alignment:''};}
 if(b.asOf){const t=Date.parse(str(b.asOf));if(!Number.isFinite(t)||t<window.start||t>=window.end)throw new HttpError(400,'As-of timestamp must be inside the reporting interval.');window={...window,end:t+1};}
 const due=(d:RecordData)=>{const date=str(d.scheduledEnd)||str(d.dueDate);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return NaN;try{const z=str(obj(d.cycleAdmission).timeZone)||calendars.find(c=>c.id===legalId(d))?.zone||zone;return midnight(new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10),validZone(z)?z:zone);}catch{return NaN;}};
 // Reconcile against record history, never run mutating workflow refresh in reporting.
 const orderByCode=new Map(all.filter(r=>r.kind==='wo').map(r=>[r.id,r]));
 const ts=selected.map(r=>{if(r.kind==='wr'&&!r.data.analyticsConvertedAt&&['confirmed','converted','to_be_assessed'].includes(str(r.data.status))){const linked=orderByCode.get(str(r.data.woCode));if(linked&&linked.data.executionMode!=='request_closure'&&str(linked.data.createdAt))return timeline({...r,data:{...r.data,analyticsConvertedAt:linked.data.createdAt}},now);}return timeline(r,now);}),w={start:window.start,end:window.end};
 const request=summarize(ts.filter(x=>x.kind==='wr'),w,now,due),order=summarize(ts.filter(x=>x.kind==='wo'),w,now,due);
 const pack=(s:typeof request)=>({metrics:s.metrics,coverage:s.coverage,states:s.states,liveStates:s.liveStates,age:s.age,dwell:s.dwell});
 const previous={start:w.start-(w.end-w.start),end:w.start};
 const comparison={wr:pack(summarize(ts.filter(x=>x.kind==='wr'),previous,now,due)),wo:pack(summarize(ts.filter(x=>x.kind==='wo'),previous,now,due)),basis:'Equal elapsed interval immediately preceding selected start'};
 const trends=trendBuckets(window,choice,calendar).map(bucket=>{
  const a=ts.filter(t=>t.kind==='wr').map(t=>events(t,bucket)),z=ts.filter(t=>t.kind==='wo').map(t=>events(t,bucket));
  return {label:bucket.label,start:new Date(bucket.start).toISOString(),end:new Date(bucket.end).toISOString(),wrCreated:a.filter(e=>e.created).length,wrConverted:a.filter(e=>e.converted).length,woCreated:z.filter(e=>e.created).length,woClosed:z.filter(e=>e.closed).length,wrBacklog:a.filter(e=>e.backlog).length,woBacklog:z.filter(e=>e.backlog).length};
 });
 const kind=(str(b.kind)||'wo') as Kind,metric=(str(b.metric)||'all') as Metric,state=str(b.state);
 if(!['wr','wo'].includes(kind)||!['created','converted','closed','cancelled','backlog','opening','overdue','cohort','unknown','all'].includes(metric))throw new HttpError(400,'Invalid drill-through filter.');
 const report=kind==='wr'?request:order;
 const matching=report.rows.filter(row=>selectMetric(row,metric,state)&&(metric!=='all'||row.e.end!==null)).sort((a,b)=>b.t.created-a.t.created||a.t.id.localeCompare(b.t.id));
 const offset=Math.max(0,Math.floor(Number(b.offset)||0)),limit=b.export===true?Math.min(5000,matching.length):100;
 const detail=matching.slice(offset,offset+limit).map(({t,e})=>({code:t.id,title:str(t.data.title),state:e.end||'Not yet created',stateLabel:labels[e.end||'']||e.end||'Not yet created',liveState:t.current,createdAt:Number.isFinite(t.created)?new Date(t.created).toISOString():'',equipment:str(t.data.unitName),site:str(t.data.siteName),workGroup:str(t.data.workGroupName),scheduledEnd:str(t.data.scheduledEnd),overdue:e.overdue,employeeIds:employeeIds(t.data,t.kind)}));
 // Distinct records per grouping key; employee attribution is non-additive across employees.
 const breakdown=(dimension:string)=>{const counts=new Map<string,{id:string;label:string;created:number;closed:number;converted:number;backlog:number;overdue:number;count:number}>();for(const {t,e} of report.rows){if(!e.end)continue;const d=t.data,keys=dimension==='employee'?employeeIds(d,t.kind):dimension==='group'?[str(d.workGroupId)]:dimension==='equipment'?[str(d.assetTag)||str(d.unitId)]:[texts(d.path).find(id=>nodeMap.get(id)?.data.level===dimension)||''];for(const id of [...new Set(keys.filter(Boolean))]){const label=dimension==='employee'?peopleMap.get(id)||id:dimension==='group'?str(d.workGroupName)||id:dimension==='equipment'?str(d.assetName)||str(d.unitName)||id:nodeMap.has(id)?name(nodeMap.get(id)!):id;const k=counts.get(id)||{id,label,created:0,closed:0,converted:0,backlog:0,overdue:0,count:0};k.created+=Number(e.created);k.closed+=Number(e.closed);k.converted+=Number(e.converted);k.backlog+=Number(e.backlog);k.overdue+=Number(e.overdue);k.count++;counts.set(id,k);}}return [...counts.values()].sort((a,b)=>b.backlog-a.backlog||b.count-a.count).slice(0,100);};
 const dimension=str(b.dimension)||'work_center';
 const reported=new Map<string,{id:string;label:string;hours:number;entries:number}>();
 for(const r of selected.filter(r=>r.kind==='wo'))for(const log of rows(r.data.timeLogs)){const id=str(log.uid),date=str(log.date),hours=typeof log.hours==='number'?log.hours:typeof log.minutes==='number'?log.minutes/60:NaN;if(!id||employee&&id!==employee||!Number.isFinite(hours)||hours<0||date<window.startDate||date>window.endDate||midnight(date,window.zone)>=w.end)continue;const v=reported.get(id)||{id,label:peopleMap.get(id)||id,hours:0,entries:0};v.hours+=hours;v.entries++;reported.set(id,v);}
 return {...base,reportedEmployeeHours:[...reported.values()].sort((a,b)=>b.hours-a.hours),alignment,window:{...window,start:new Date(window.start).toISOString(),end:new Date(window.end).toISOString()},wr:pack(request),wo:pack(order),comparison,trends,breakdown:breakdown(dimension),dimension,detail,total:matching.length,offset,limit,coverageNote:'Historical states are known only from recorded transitions. Current organizational assignments are used for historical grouping; unknown historical intervals are not backfilled. Elapsed waiting time is not downtime or man-hours.'};
}
export const maintenanceAnalyticsRoutes={
 'POST /api/org/mnt/analytics':[orgRoute('org.mnt.analytics','MNT.view',analytics)],
 'POST /api/org/mnt/analytics/preferences':[orgRoute('org.mnt.analytics.preferences','MNT.view',async ctx=>{
  enabled(ctx);const path='organizations/'+ctx.orgId+'/maintenance_dashboard_preferences/'+ctx.uid,prior=await getDoc(path);
  if(ctx.body.action==='save'){const raw=ctx.body.views;if(!Array.isArray(raw)||raw.length>12||JSON.stringify(raw).length>24000)throw new HttpError(400,'Save at most 12 compact views.');const views=raw.filter(isObj).map(v=>({name:str(v.name).slice(0,80),settings:obj(v.settings)}));if(!await writeDoc(path,{views,updatedAt:nowIso(),uid:ctx.uid},prior?{updateTime:prior.updateTime}:{exists:false}))throw new HttpError(409,'View settings changed. Reload.');return {views};}
  return {views:rows(prior?.data.views)};
 })]
};
