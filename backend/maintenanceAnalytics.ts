import {HttpError,getDoc,listDocs,isObj,str,nowIso,writeDoc,type Obj,type Doc} from './core';
import {orgRoute,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {outsideExecutionAccess} from './maintenanceWorkGroupPolicy';
import {entityOf,yearsOf} from './finCore';
import {timeline,summarize,events,selectMetric,liveWorkOrderHealth,matchLiveWorkOrder,LIVE_WO_METRICS,type Kind,type Metric,type RecordInput,type RecordData} from './maintenanceAnalyticsCore';
import {PERIODS,periodBounds,trendBuckets,midnight,type Calendar,type PeriodChoice} from './maintenanceAnalyticsCalendar';
import {WO_STATES} from './maintenanceWorkflowState';
import {resolveTargets,validateTargetValues,validateSharedLayout,type TargetRule,type SharedLayout} from './maintenanceAnalyticsTargets';
import {audit} from './audit';
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
 const [nodes,wr,wo,targetDoc]=await Promise.all([listDocs(root+'/structure'),listDocs(root+'/work_requests'),listDocs(root+'/work_orders'),getDoc(root+'/maintenance_analytics_settings/targets')]);
 const all:RecordInput[]=[...wr.filter(d=>str(d.data.requestedBy)===ctx.uid||canAt(ctx,'MNT.view',texts(d.data.path),scope)).map(d=>({kind:'wr' as const,id:d.id,data:d.data})),...wo.filter(d=>canAt(ctx,'MNT.view',texts(d.data.path),scope)||outsideExecutionAccess(ctx.workGroupPolicy,d)).map(d=>({kind:'wo' as const,id:d.id,data:d.data}))];
 const nodeMap=new Map(nodes.map(n=>[n.id,n]));
 const allowedNodes=new Set(all.flatMap(r=>texts(r.data.path)));
 // Derive authorized empty locations too, using actual scope checks on their master hierarchy.
 const nodePath=(id:string)=>{const p:string[]=[],seen=new Set<string>();let next=id;while(next&&next!=='root'&&p.length<30&&!seen.has(next)){const n=nodeMap.get(next);if(!n)break;seen.add(next);p.unshift(next);next=str(n.data.parentId);}return p;};
 for(const n of nodes){const p=nodePath(n.id);if(p.length&&canAt(ctx,'MNT.view',p,scope))for(const id of p)allowedNodes.add(id);}
 const legalId=(d:RecordData)=>texts(d.path).find(id=>nodeMap.get(id)?.data.level==='legal_entity')||'';
 const leIds=[...new Set([...all.map(r=>legalId(r.data)).filter(Boolean),...nodes.filter(n=>allowedNodes.has(n.id)&&n.data.level==='legal_entity').map(n=>n.id)])];
 const options=nodes.filter(n=>allowedNodes.has(n.id)).map(n=>({id:n.id,label:name(n),level:str(n.data.level),parentId:str(n.data.parentId),code:str(n.data.code)}));
 const groups=[...new Map(all.filter(r=>str(r.data.workGroupId)).map(r=>[str(r.data.workGroupId),{id:str(r.data.workGroupId),label:str(r.data.workGroupName)||str(r.data.workGroupCode)}])).values()];
 const peopleIds=new Set(all.flatMap(r=>employeeIds(r.data,r.kind)));
 // Only identities already visible on authorized records may appear in this report.
 const peopleMap=new Map<string,string>();for(const r of all){const d=r.data;for(const [id,n] of [[d.requestedBy,d.requestedByName],[d.reviewer,d.reviewerName],[d.reviewerUid,d.reviewAssignedName],[d.assessedBy,d.assessedByName],[d.plannedBy,d.plannedByName],[d.completedBy,d.completedByName],...rows(d.assignees).map(x=>[x.uid,x.name]),...rows(d.timeLogs).map(x=>[x.uid,x.name])])if(str(id)&&str(n))peopleMap.set(str(id),str(n));}
 const people=[...peopleIds].map(id=>({id,label:peopleMap.get(id)||id})).sort((a,b)=>a.label.localeCompare(b.label));
 const b=ctx.body,choice=(str(b.period)||'today') as PeriodChoice;if(!PERIODS.includes(choice))throw new HttpError(400,'Unknown reporting period.');
 const node=str(b.node),group=str(b.group),employee=str(b.employee),legal=str(b.legalEntity),asset=str(b.asset),country=str(b.country);
 const countryOf=(d:RecordData)=>{const n=nodeMap.get(legalId(d));return str(obj(n?.data.attributes).countryCode)||str(n?.data.countryCode);};
 const countries=[...new Set([...all.map(r=>countryOf(r.data)),...leIds.map(id=>str(obj(nodeMap.get(id)?.data.attributes).countryCode)||str(nodeMap.get(id)?.data.countryCode))].filter(Boolean))].map(id=>({id,label:id}));
 const assets=[...new Map(all.filter(r=>str(r.data.assetTag)||str(r.data.unitId)).map(r=>{const id=str(r.data.assetTag)||str(r.data.unitId);return [id,{id,label:str(r.data.assetName)||str(r.data.unitName)||id}];})).values()];
 if(node&&!allowedNodes.has(node)||group&&!groups.some(g=>g.id===group)||employee&&!peopleIds.has(employee)||legal&&!leIds.includes(legal)||asset&&!assets.some(a=>a.id===asset)||country&&!countries.some(c=>c.id===country))throw new HttpError(403,'Reporting scope is outside your accessible maintenance records.');
 const selected=all.filter(r=>(!node||texts(r.data.path).includes(node))&&(!group||r.data.workGroupId===group)&&(!employee||employeeIds(r.data,r.kind).includes(employee))&&(!legal||legalId(r.data)===legal)&&(!asset||(str(r.data.assetTag)||str(r.data.unitId))===asset)&&(!country||countryOf(r.data)===country));
 const selectedLE=[...new Set(legal?[legal]:selected.length?selected.map(r=>legalId(r.data)).filter(Boolean):leIds.filter(id=>(!node||nodePath(id).includes(node)||nodePath(node).includes(id))&&(!country||(str(obj(nodeMap.get(id)?.data.attributes).countryCode)||str(nodeMap.get(id)?.data.countryCode))===country)))];
 const baseZone=str(ctx.org.data.timeZone)||str(ctx.org.data.timezone)||'UTC',zone=validZone(baseZone)?baseZone:'UTC';
 const now=Date.now(),customStart=str(b.start),customEnd=str(b.end);
 const calendars:Calendar[]=await Promise.all(selectedLE.map(async id=>{const [entity,years]=await Promise.all([entityOf(ctx.orgId,id),yearsOf(ctx.orgId,id)]);const n=nodeMap.get(id),z=str(obj(n?.data.attributes).timeZone)||str(n?.data.timeZone)||zone;return {id,name:n?name(n):id,zone:validZone(z)?z:zone,weekEndDay:entity.settings?.weekEndDay??-1,years:years.filter(y=>y.status==='active'||y.status==='closed').map(y=>({fy:y.fy,label:y.label,start:y.start,end:y.end,periods:y.periods.map(p=>({no:p.no,name:p.name,start:p.start,end:p.end,special:p.special}))}))};}));
 const general:Calendar={id:'',name:'Organization reporting timezone',zone,weekEndDay:6,years:[]};
 const canManageTargets=ctx.role==='org_super_admin';
 const targetRules=rows(targetDoc?.data.rules).flatMap(r=>{try{return [{scope:str(r.scope),values:validateTargetValues(r.values)}];}catch{return [];}});
 const scopeChain:string[]=[],explicitScope=employee?'employee:'+employee:asset?'asset:'+asset:group?'group:'+group:node?'node:'+node:legal?'node:'+legal:country?'country:'+country:'org';
 const common=(paths:string[][])=>paths.length?paths[0].filter((id,i)=>paths.every(p=>p[i]===id)):[];
 const scopedPaths=selected.map(r=>texts(r.data.path));
 const inferred=(asset||group||employee)&&scopedPaths.length?common(scopedPaths):nodePath(node||legal);
 const targetCountry=country||((node||legal||asset||group||employee)&&selectedLE.length===1?(str(obj(nodeMap.get(selectedLE[0])?.data.attributes).countryCode)||str(nodeMap.get(selectedLE[0])?.data.countryCode)):'');
 if(targetCountry)scopeChain.push('country:'+targetCountry);scopeChain.push(...inferred.map(id=>'node:'+id));
 if(group)scopeChain.push('group:'+group);else if((asset||employee)&&selected.length&&selected.every(r=>r.data.workGroupId===selected[0].data.workGroupId)&&str(selected[0].data.workGroupId))scopeChain.push('group:'+str(selected[0].data.workGroupId));
 if(asset)scopeChain.push('asset:'+asset);if(employee)scopeChain.push('employee:'+employee);
 const targets={woMaxOverdueDays:{value:7,source:'org'},...resolveTargets(targetRules,scopeChain)};
 const base={options,groups,people,assets,countries,targets,canManageTargets,targetScope:explicitScope,targetVersion:Number(targetDoc?.data.version)||0,legalEntities:leIds.map(id=>({id,label:nodeMap.has(id)?name(nodeMap.get(id)!):id})),stateLabels:labels,asOf:new Date(now).toISOString()};
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
 if(b.sliceStart||b.sliceEnd){const a=Date.parse(str(b.sliceStart)),z=Date.parse(str(b.sliceEnd));if(!Number.isFinite(a)||!Number.isFinite(z)||a<window.start||z>window.end||a>=z)throw new HttpError(400,'Selected trend bucket is outside the reporting period.');window={...window,start:a,end:z};}
 if(b.asOf){const t=Date.parse(str(b.asOf));if(!Number.isFinite(t)||t<window.start||t>=window.end)throw new HttpError(400,'As-of timestamp must be inside the reporting interval.');window={...window,end:t+1};}
 const due=(d:RecordData)=>{const date=str(d.scheduledEnd)||str(d.dueDate);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return NaN;try{const z=str(obj(d.cycleAdmission).timeZone)||calendars.find(c=>c.id===legalId(d))?.zone||zone;return midnight(new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10),validZone(z)?z:zone);}catch{return NaN;}};
 // Reconcile against record history, never run mutating workflow refresh in reporting.
 const orderByCode=new Map(all.filter(r=>r.kind==='wo').map(r=>[r.id,r]));
 const ts=selected.map(r=>{if(r.kind==='wr'&&!r.data.analyticsConvertedAt&&['confirmed','converted','to_be_assessed'].includes(str(r.data.status))){const linked=orderByCode.get(str(r.data.woCode));if(linked&&linked.data.executionMode!=='request_closure'&&str(linked.data.createdAt))return timeline({...r,data:{...r.data,analyticsConvertedAt:linked.data.createdAt}},now);}return timeline(r,now);}),w={start:window.start,end:window.end};
 const localDay=(d:RecordData,at:number)=>{const z=str(obj(d.currentCycleAdmission).timeZone)||str(obj(d.cycleAdmission).timeZone)||calendars.find(c=>c.id===legalId(d))?.zone||zone;const p=new Intl.DateTimeFormat('en-CA',{timeZone:validZone(z)?z:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));return ['year','month','day'].map(k=>p.find(x=>x.type===k)?.value).join('-');};
 const {records:healthRecords,...woHealth}=liveWorkOrderHealth(ts,now,localDay);
 const healthById=new Map(healthRecords.map(r=>[r.t.id,r]));
 const request=summarize(ts.filter(x=>x.kind==='wr'),w,now,due),order=summarize(ts.filter(x=>x.kind==='wo'),w,now,due);
 const pack=(s:typeof request)=>({metrics:s.metrics,coverage:s.coverage,states:s.states,liveStates:s.liveStates,age:s.age,dwell:s.dwell});
 let previous={start:w.start-(w.end-w.start),end:w.start};let basis='Equal elapsed interval immediately preceding selected start';
 const previousChoice=choice==='current_month'?'last_month':choice==='current_year'?'last_year':choice==='current_week'?'last_week':choice==='today'?'yesterday':null;
 if(previousChoice&&!b.sliceStart){try{const p=periodBounds(previousChoice,calendar,now);const other=calendars.map(c=>periodBounds(previousChoice,c,now));if(other.every(x=>x.start===p.start&&x.plannedEnd===p.plannedEnd)){previous={start:p.start,end:Math.min(p.end,p.start+(w.end-w.start))};basis='Equivalent elapsed portion of '+p.label;}}catch{/* explicit equal-elapsed fallback */}}
 const comparison={wr:pack(summarize(ts.filter(x=>x.kind==='wr'),previous,now,due)),wo:pack(summarize(ts.filter(x=>x.kind==='wo'),previous,now,due)),basis};
 const trends=trendBuckets(window,choice,calendar).map(bucket=>{
  const a=ts.filter(t=>t.kind==='wr').map(t=>events(t,bucket)),z=ts.filter(t=>t.kind==='wo').map(t=>events(t,bucket));
  const count=(v:typeof a)=>Object.fromEntries([...new Set(v.map(e=>e.end).filter(Boolean))].map(s=>[s!,v.filter(e=>e.end===s).length]));
  return {label:bucket.label,start:new Date(bucket.start).toISOString(),end:new Date(bucket.end).toISOString(),wrCreated:a.filter(e=>e.created).length,wrConverted:a.filter(e=>e.converted).length,woCreated:z.filter(e=>e.created).length,woClosed:z.filter(e=>e.closed).length,wrBacklog:a.filter(e=>e.backlog).length,woBacklog:z.filter(e=>e.backlog).length,wrStates:count(a),woStates:count(z)};
 });
 const kind=(str(b.kind)||'wo') as Kind,metric=(str(b.metric)||'all') as Metric,state=str(b.state),liveHealthMetric=(LIVE_WO_METRICS as readonly string[]).includes(metric);
 if(!['wr','wo'].includes(kind)||(!['created','converted','closed','cancelled','backlog','opening','overdue','cohort','unknown','all'].includes(metric)&&!(kind==='wo'&&liveHealthMetric)))throw new HttpError(400,'Invalid drill-through filter.');
 const report=kind==='wr'?request:order;
 const isLive=liveHealthMetric||b.live===true&&metric==='all';
 const matching=report.rows.filter(row=>liveHealthMetric?!!healthById.get(row.t.id)&&matchLiveWorkOrder(healthById.get(row.t.id)!,metric,state):isLive?(Number.isFinite(row.t.created)&&row.t.created<=now&&(!state||row.t.current===state)):(selectMetric(row,metric,state)&&(metric!=='all'||row.e.end!==null))).sort((a,b)=>b.t.created-a.t.created||a.t.id.localeCompare(b.t.id));
 const offset=Math.max(0,Math.floor(Number(b.offset)||0)),limit=b.export===true?Math.min(5000,matching.length):Math.max(10,Math.min(100,Math.floor(Number(b.pageSize)||100)));
 const detail=matching.slice(offset,offset+limit).map(({t,e})=>({code:t.id,title:str(t.data.title),state:isLive?t.current:e.end||'Not yet created',stateLabel:isLive?labels[t.current]||t.current:labels[e.end||'']||e.end||'Not yet created',liveState:t.current,createdAt:Number.isFinite(t.created)?new Date(t.created).toISOString():'',equipment:str(t.data.unitName),site:str(t.data.siteName),workGroup:str(t.data.workGroupName),scheduledEnd:str(t.data.scheduledEnd),scheduledStart:str(t.data.scheduledStart),ageDays:healthById.get(t.id)?.ageDays??null,overdueDays:healthById.get(t.id)?.overdueDays??null,spareCount:healthById.get(t.id)?.spareCount??null,overdue:liveHealthMetric?(healthById.get(t.id)?.overdueDays??0)>0:e.overdue,employeeIds:employeeIds(t.data,t.kind)}));
 // Distinct records per grouping key; employee attribution is non-additive across employees.
 const breakdown=(dimension:string)=>{const counts=new Map<string,{id:string;label:string;created:number;closed:number;converted:number;backlog:number;overdue:number;count:number}>();for(const {t,e} of report.rows){if(!e.end)continue;const d=t.data,keys=dimension==='employee'?employeeIds(d,t.kind):dimension==='country'?[countryOf(d)]:dimension==='group'?[str(d.workGroupId)]:dimension==='equipment'?[str(d.assetTag)||str(d.unitId)]:[texts(d.path).find(id=>nodeMap.get(id)?.data.level===dimension)||''];for(const id of [...new Set(keys.filter(Boolean))]){const label=dimension==='employee'?peopleMap.get(id)||id:dimension==='country'?id:dimension==='group'?str(d.workGroupName)||id:dimension==='equipment'?str(d.assetName)||str(d.unitName)||id:nodeMap.has(id)?name(nodeMap.get(id)!):id;const k=counts.get(id)||{id,label,created:0,closed:0,converted:0,backlog:0,overdue:0,count:0};k.created+=Number(e.created);k.closed+=Number(e.closed);k.converted+=Number(e.converted);k.backlog+=Number(e.backlog);k.overdue+=Number(e.overdue);k.count++;counts.set(id,k);}}return [...counts.values()].sort((a,b)=>b.backlog-a.backlog||b.count-a.count).slice(0,100);};
 const dimension=str(b.dimension)||'work_center';
 const reported=new Map<string,{id:string;label:string;hours:number;entries:number}>();
 for(const r of selected.filter(r=>r.kind==='wo'))for(const log of rows(r.data.timeLogs)){const id=str(log.uid),date=str(log.date),hours=typeof log.hours==='number'?log.hours:typeof log.minutes==='number'?log.minutes/60:NaN;if(!id||employee&&id!==employee||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||!Number.isFinite(hours)||hours<0||date<window.startDate||date>window.endDate||midnight(date,window.zone)>=w.end||w.end-w.start<24*3600000&&b.sliceStart)continue;const v=reported.get(id)||{id,label:peopleMap.get(id)||id,hours:0,entries:0};v.hours+=hours;v.entries++;reported.set(id,v);}
 const selectedWO=new Set(selected.filter(r=>r.kind==='wo').map(r=>r.id));for(const log of await listDocs(root+'/maintenance_time_bookings')){const d=log.data,id=str(d.uid);if(!selectedWO.has(str(d.woCode))||d.classCode!=='DIRECT'||!['recorded','approved'].includes(str(d.status))||!id||employee&&employee!==id)continue;const a=Date.parse(str(d.start)),z=Date.parse(str(d.end));if(!Number.isFinite(a)||!Number.isFinite(z)||z<=a)continue;const hours=Math.max(0,Math.min(w.end,z)-Math.max(w.start,a))/3600000;if(!hours)continue;const v=reported.get(id)||{id,label:peopleMap.get(id)||str(d.name)||id,hours:0,entries:0};v.hours+=hours;v.entries++;reported.set(id,v);}
 return {...base,woHealth,reportedEmployeeHours:[...reported.values()].sort((a,b)=>b.hours-a.hours),alignment,window:{...window,start:new Date(window.start).toISOString(),end:new Date(window.end).toISOString()},wr:pack(request),wo:pack(order),comparison,trends,breakdown:breakdown(dimension),dimension,detail,total:matching.length,offset,limit,coverageNote:'Historical states are known only from recorded transitions. Current organizational assignments are used for historical grouping; unknown historical intervals are not backfilled. Elapsed waiting time is not downtime or man-hours.'};
}
export const maintenanceAnalyticsRoutes={
 'POST /api/org/mnt/analytics/targets':[orgRoute('org.mnt.analytics.targets','ADM.workflows',async ctx=>{
  enabled(ctx);if(ctx.role!=='org_super_admin')throw new HttpError(403,'Organization Super Admin is required to configure KPI targets.');const root='organizations/'+ctx.orgId,path=root+'/maintenance_analytics_settings/targets',prior=await getDoc(path),version=Number(prior?.data.version)||0;
  if(ctx.body.action!=='save')return {version,rules:rows(prior?.data.rules)};
  if(ctx.body.expectedVersion!==version)throw new HttpError(409,'Targets changed; reload before saving.');const reason=str(ctx.body.reason).trim().slice(0,500),scope=str(ctx.body.scope);if(reason.length<10)throw new HttpError(400,'Enter the reason for target change (at least 10 characters).');
  const [kind,...rest]=scope.split(':'),id=rest.join(':');if(scope!=='org'){
   if(!id||id.length>128||!['node','group','asset','employee','country'].includes(kind))throw new HttpError(400,'Invalid target scope.');
   const [nodes,orders,requests,groups]=await Promise.all([listDocs(root+'/structure'),listDocs(root+'/work_orders'),listDocs(root+'/work_requests'),listDocs(root+'/maintenance_work_groups')]);
   const exists=kind==='node'?nodes.some(n=>n.id===id):kind==='group'?groups.some(g=>g.id===id):kind==='asset'?[...orders,...requests].some(r=>(str(r.data.assetTag)||str(r.data.unitId))===id):kind==='employee'?str((await getDoc('users/'+id))?.data.orgId)===ctx.orgId:nodes.some(n=>n.data.level==='legal_entity'&&(str(obj(n.data.attributes).countryCode)||str(n.data.countryCode))===id);
   if(!exists)throw new HttpError(403,'Target scope is not part of this organization.');
  }
  let values;try{values=validateTargetValues(ctx.body.values);}catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid target');}
  const rules=[...rows(prior?.data.rules).filter(r=>r.scope!==scope),...(Object.keys(values).length?[{scope,values}]:[])];if(rules.length>400)throw new HttpError(400,'Target override limit reached.');
  const updatedAt=nowIso();if(!await writeDoc(path,{rules,version:version+1,updatedAt,updatedBy:ctx.uid},prior?{updateTime:prior.updateTime}:{exists:false}))throw new HttpError(409,'Targets changed.');
  await audit([{category:'maintenance',action:'mnt.dashboard.targets',actor:ctx.actor,meta:ctx.meta,target:{label:scope},orgId:ctx.orgId,details:reason+' · version '+(version+1)+' · '+JSON.stringify(values)}]);return {version:version+1,rules};
 })],
 'POST /api/org/mnt/analytics/shared-layouts':[orgRoute('org.mnt.analytics.shared_layouts','MNT.view',async ctx=>{
  enabled(ctx);const path='organizations/'+ctx.orgId+'/maintenance_analytics_settings/shared_layouts',prior=await getDoc(path),version=Number(prior?.data.version)||0,canManage=ctx.role==='org_super_admin';let layouts=rows(prior?.data.layouts).flatMap(v=>{try{return [validateSharedLayout(v)];}catch{return [];}});
  if(ctx.body.action==='save'){if(!canManage)throw new HttpError(403,'Organization Super Admin required.');if(ctx.body.expectedVersion!==version)throw new HttpError(409,'Shared layouts changed. Reload.');const raw=ctx.body.layouts;if(!Array.isArray(raw)||raw.length>30)throw new HttpError(400,'Up to 30 shared layouts.');try{layouts=raw.map(validateSharedLayout);}catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid shared layout');}const keys=new Set<string>();for(const l of layouts.filter(l=>l.isDefault)){if(keys.has(l.role))throw new HttpError(400,'Only one default layout for each role.');keys.add(l.role);}if(!await writeDoc(path,{layouts,version:version+1,updatedAt:nowIso(),updatedBy:ctx.uid},prior?{updateTime:prior.updateTime}:{exists:false}))throw new HttpError(409,'Layouts changed.');return {layouts,version:version+1,canManage,role:ctx.role};}
  const visible=layouts.filter(l=>l.role==='*'||l.role===ctx.role);return {layouts:canManage?layouts:visible,defaultLayout:visible.find(l=>l.isDefault&&l.role===ctx.role)||visible.find(l=>l.isDefault&&l.role==='*')||null,version,canManage,role:ctx.role};
 })],
 'POST /api/org/mnt/analytics':[orgRoute('org.mnt.analytics','MNT.view',analytics)],
 'POST /api/org/mnt/analytics/preferences':[orgRoute('org.mnt.analytics.preferences','MNT.view',async ctx=>{
  enabled(ctx);const path='organizations/'+ctx.orgId+'/maintenance_dashboard_preferences/'+ctx.uid,prior=await getDoc(path);
  if(ctx.body.action==='save'){const raw=ctx.body.views;if(!Array.isArray(raw)||raw.length>12||JSON.stringify(raw).length>24000)throw new HttpError(400,'Save at most 12 compact views.');const views=raw.filter(isObj).map(v=>({name:str(v.name).slice(0,80),settings:obj(v.settings)}));if(!await writeDoc(path,{views,updatedAt:nowIso(),uid:ctx.uid},prior?{updateTime:prior.updateTime}:{exists:false}))throw new HttpError(409,'View settings changed. Reload.');return {views};}
  return {views:rows(prior?.data.views)};
 })]
};
