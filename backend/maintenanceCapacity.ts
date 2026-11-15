import {getDoc,listDocs,writeDoc,isObj,str,nowIso,HttpError,type Doc,type Obj} from './core';
import {orgRoute,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {orgUsers} from './org';
import {audit} from './audit';
import {activeWorkGroupPath,assignmentCovers,ancestry,type ActiveWorkGroups} from './maintenanceWorkGroupPolicy';
import {withLock} from './finCore';
import {availability,validateCapacity,validDay,ruleAt,overlap,covered,spanHours,percent,inZoneDay,type CapacityRule,type Span} from './maintenanceCapacityCore';
import {localDay,midnight} from './maintenanceAnalyticsCalendar';
import {bookedHours,type TimeBooking} from './maintenanceTimeCore';
import {dateAdd} from './maintenanceAnalyticsCore';
const rows=(v:unknown)=>Array.isArray(v)?v.filter(isObj):[];
const texts=(v:unknown)=>Array.isArray(v)?v.map(str).filter(Boolean):[];
const object=(v:unknown)=>isObj(v)?v:{};
const root=(ctx:OrgContext)=>'organizations/'+ctx.orgId;
const enabled=(ctx:OrgContext)=>{if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'Maintenance is not enabled.');};
const names=(d:Doc)=>[str(d.data.firstName),str(d.data.lastName)].filter(Boolean).join(' ')||str(d.data.displayName)||d.id;
const settings=(ctx:OrgContext)=>root(ctx)+'/maintenance_workforce_settings/capacity';
export type Artisan={id:string;name:string;groupId:string;groupName:string;paths:string[][];scopeKeys:string[];skills:string[];positions:string[]};
export async function capacityContext(ctx:OrgContext,day=nowIso().slice(0,10)){
 const [active,nodes,positions,users,configuration,leaves,windows]=await Promise.all([getDoc(activeWorkGroupPath(ctx.orgId)),listDocs(root(ctx)+'/structure'),listDocs(root(ctx)+'/positions'),orgUsers(ctx.orgId),getDoc(settings(ctx)),listDocs(root(ctx)+'/hr_leave_requests'),listDocs(root(ctx)+'/maintenance_windows')]);
 const cfg=active?.data as unknown as ActiveWorkGroups|undefined;
 const executionTitles=(cfg?.tasks['MNT.TASK.FEEDBACK']||[]).filter(t=>(cfg?.tasks['MNT.WO.execute']||[]).includes(t));
 const byUser=new Map(users.filter(u=>!['disabled','inactive','suspended','deleted'].includes(str(u.data.status))).map(u=>[u.id,u]));
 const nodeMap=new Map(nodes.map(n=>[n.id,n])),positionSet=new Set(positions.filter(p=>p.data.status!=='inactive').map(p=>p.id));
 const artisans:Artisan[]=[];
 for(const g of cfg?.groups||[]){const paths=g.costCenterIds.map(id=>ancestry(nodeMap,id)).filter(p=>p.includes(g.siteId));const qualified=new Map<string,Set<string>>();for(const t of executionTitles)for(const m of g.members[t]||[]){const u=byUser.get(m.uid);if(!u||!positionSet.has(m.positionCode)||!(cfg?.roleAlignment[t]||[]).includes(m.positionCode)||!paths.some(p=>assignmentCovers(u,m.positionCode,p,day)))continue;const set=qualified.get(m.uid)||new Set<string>();set.add(m.positionCode);qualified.set(m.uid,set);}
 for(const [id,ps] of qualified){const u=byUser.get(id)!;const common=paths.length?paths[0].filter((x,i)=>paths.every(p=>p[i]===x)):[];artisans.push({id,name:names(u),groupId:g.id,groupName:g.name,paths,scopeKeys:[...common.map(x=>'node:'+x),'group:'+g.id,'employee:'+id],skills:texts(u.data.skillCodes),positions:[...ps]});}}
 const unique=artisans.filter(a=>artisans.filter(x=>x.id===a.id).length===1);
 const rules=rows(configuration?.data.rules).flatMap(r=>{try{return [{scope:str(r.scope),effectiveFrom:str(r.effectiveFrom),values:validateCapacity(r.values)}];}catch{return [];}}) as CapacityRule[];
 const approvedLeave=leaves.filter(l=>l.data.kind==='application'&&l.data.status==='approved').map(l=>({uid:str(l.data.employeeUid),start:str(l.data.start),end:str(l.data.end)}));
 const bookings=windows.filter(w=>!['superseded','cancelled','rejected','draft'].includes(str(w.data.status))&&!object(w.data.finalClosure).at).flatMap(w=>rows(object(w.data.schedule).tasks).flatMap(t=>{const start=Date.parse(str(w.data.start))+Number(t.start)*3600000,end=Date.parse(str(w.data.start))+Number(t.finish)*3600000;return Number.isFinite(start)&&end>start?texts(t.personnel).map(uid=>({uid,start,end,windowId:w.id,woCode:str(t.woCode),taskId:str(t.taskId)})):[];}));
 return {artisans:unique,rules,approvedLeave,bookings,configuration,nodes,active:!!cfg};
}
export async function capacityForWindow(ctx:OrgContext,start:string,tasks:Obj[],excludeWindow:string){
 const c=await capacityContext(ctx),base=Date.parse(start),warnings:string[]=[],blockers:string[]=[];
 const seen:Array<Span&{uid:string;taskId:string}>=[];
 for(const t of tasks){const span={start:base+Number(t.start)*3600000,end:base+Number(t.finish)*3600000};if(!Number.isFinite(span.start)||!Number.isFinite(span.end)||span.end<=span.start)continue;
 for(const uid of texts(t.personnel)){const person=c.artisans.find(a=>a.id===uid),key=str(t.woCode)+' / '+str(t.taskId),label=person?.name||uid;
 if(c.bookings.some(b=>b.uid===uid&&b.windowId!==excludeWindow&&overlap(b,span))||seen.some(b=>b.uid===uid&&overlap(b,span)))blockers.push(key+': '+label+' has a conflicting scheduled activity.');
 seen.push({...span,uid,taskId:key});
 if(!person){warnings.push(key+': execution-role capacity is not configured for '+label+'.');continue;}
 const first=ruleAt(c.rules,person.scopeKeys,new Date(span.start).toISOString().slice(0,10));if(!first){warnings.push(key+': '+label+' has no effective capacity configuration.');continue;}
 const zone=first.values.zone,from=inZoneDay(span.start,zone),through=inZoneDay(span.end-1,zone),av=availability(c.rules,person.scopeKeys,dateAdd(from,-1),through,c.approvedLeave.filter(l=>l.uid===uid));
 if(!covered(span,av.net))blockers.push(key+': '+label+' is outside configured working hours or on approved leave.');
 }
 }
 return {blockers:[...new Set(blockers)],warnings:[...new Set(warnings)]};
}
export const maintenanceCapacityRoutes={
 'POST /api/org/mnt/workforce/capacity':[orgRoute('org.mnt.workforce.capacity','MNT.view',async ctx=>{
 enabled(ctx);const s=await scopeOf(ctx),from=str(ctx.body.from)||nowIso().slice(0,10),through=str(ctx.body.through)||dateAdd(from,6);
 if(!validDay(from)||!validDay(through)||from>through||Date.parse(through)-Date.parse(from)>92*86400000)throw new HttpError(400,'Choose up to 93 days.');
 const c=await capacityContext(ctx,from);const managed=c.artisans.filter(a=>a.id===ctx.uid||a.paths.some(p=>canAt(ctx,'MNT.WO.plan',p,s))||ctx.role==='org_super_admin');
 const logs=await listDocs(root(ctx)+'/maintenance_time_bookings');
 const data=managed.map(a=>{const av=availability(c.rules,a.scopeKeys,from,through,c.approvedLeave.filter(l=>l.uid===a.id));const rule=ruleAt(c.rules,a.scopeKeys,from),zone=rule?.values.zone||'UTC';const start=midnight(from,zone),end=midnight(dateAdd(through,1),zone);const planned=c.bookings.filter(b=>b.uid===a.id&&overlap(b,{start,end})).reduce((n,b)=>n+(Math.min(end,b.end)-Math.max(start,b.start))/3600000,0);const entries=logs.filter(d=>d.data.uid===a.id);const toBooking=(d:Doc):TimeBooking=>({uid:a.id,start:str(d.data.start),end:str(d.data.end),status:str(d.data.status)});const hours=(filter:(d:Doc)=>boolean)=>bookedHours(entries.filter(filter).map(toBooking),{start,end:Math.min(end,Date.now())},Date.now());const actual=hours(d=>d.data.classCode==='DIRECT'),productive=hours(d=>d.data.productive===true),accounted=hours(()=>true),hasTime=entries.some(d=>['recorded','approved'].includes(str(d.data.status))&&overlap({start:Date.parse(str(d.data.start)),end:Date.parse(str(d.data.end))},{start,end}));return {actualHours:hasTime?actual:null,productiveHours:hasTime?productive:null,accountedHours:hasTime?accounted:null,utilization:hasTime&&!av.missingDays?percent(actual,av.netHours):null,accountability:hasTime&&!av.missingDays?percent(accounted,av.netHours):null,id:a.id,name:a.name,groupId:a.groupId,groupName:a.groupName,skills:a.skills,capacitySource:rule?.scope||'',zone,grossHours:av.missingDays?null:av.grossHours,netHours:av.missingDays?null:av.netHours,targetHours:av.missingDays?null:av.loadableHours,missingDays:av.missingDays,plannedHours:planned,loading:av.missingDays?null:percent(planned,av.netHours),targetAchievement:av.missingDays?null:percent(planned,av.loadableHours)}});
 return {people:data,from,through,activeRolesConfigured:c.active,canManage:ctx.role==='org_super_admin',version:Number(c.configuration?.data.version)||0,rules:ctx.role==='org_super_admin'?c.rules:[],scopes:ctx.role==='org_super_admin'?[{id:'org',label:'Organization defaults'},...c.nodes.filter(n=>n.data.level==='work_center'||n.data.level==='cost_center').map(n=>({id:'node:'+n.id,label:str(n.data.name)||n.id})),...[...new Map(c.artisans.map(a=>[a.groupId,{id:'group:'+a.groupId,label:a.groupName}])).values()],...c.artisans.map(a=>({id:'employee:'+a.id,label:a.name}))]:[],coverage:'Approved HR leave applications are deducted. Rotating roster, holiday and approved overtime adapters are not yet integrated; configured weekly shifts are the capacity basis.'};
 })],
 'POST /api/org/mnt/workforce/capacity/save':[orgRoute('org.mnt.workforce.capacity.save','ADM.workflows',async ctx=>withLock(ctx.orgId,'maintenance_operations',async()=>{
 enabled(ctx);if(ctx.role!=='org_super_admin')throw new HttpError(403,'Organization Super Admin is required.');const c=await capacityContext(ctx),scope=str(ctx.body.scope),effectiveFrom=str(ctx.body.effectiveFrom),reason=str(ctx.body.reason).trim().slice(0,500),version=Number(c.configuration?.data.version)||0;
 if(ctx.body.expectedVersion!==version)throw new HttpError(409,'Capacity changed. Reload.');if(!validDay(effectiveFrom)||effectiveFrom<nowIso().slice(0,10)||reason.length<10)throw new HttpError(400,'Use a current/future effective date and a reason of at least 10 characters.');
 if(scope!=='org'&&!c.nodes.some(n=>scope==='node:'+n.id&&['work_center','cost_center'].includes(str(n.data.level)))&&!c.artisans.some(a=>scope==='group:'+a.groupId||scope==='employee:'+a.id))throw new HttpError(400,'Choose a valid capacity scope.');
 let values;try{values=validateCapacity(ctx.body.values);}catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid capacity');}
 const rules=[...c.rules.filter(r=>r.scope!==scope||r.effectiveFrom!==effectiveFrom),{scope,effectiveFrom,values}];if(rules.length>1000)throw new HttpError(409,'Capacity configuration limit reached.');
 const at=nowIso();if(!await writeDoc(settings(ctx),{rules,version:version+1,updatedAt:at,updatedBy:ctx.uid},c.configuration?{updateTime:c.configuration.updateTime}:{exists:false}))throw new HttpError(409,'Capacity configuration changed.');
 await audit([{category:'maintenance',action:'mnt.capacity.saved',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:scope},details:effectiveFrom+' · '+reason}]);return {ok:true,version:version+1};
 }))],
};
