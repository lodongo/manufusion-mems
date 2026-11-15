import {randomUUID} from 'node:crypto';
import {getDoc,listDocs,writeDoc,isObj,str,nowIso,HttpError,type Obj} from './core';
import {orgRoute,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {audit} from './audit';
import {withLock} from './finCore';
import {capacityContext} from './maintenanceCapacity';
import {validDay,overlap} from './maintenanceCapacityCore';
async function calendarRoute(ctx:OrgContext){
 if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'Maintenance is not enabled.');
 const root='organizations/'+ctx.orgId,col=root+'/maintenance_workforce_calendar',b=ctx.body,action=str(b.action)||'read',c=await capacityContext(ctx),s=await scopeOf(ctx),admin=ctx.role==='org_super_admin';
 const manages=(uid:string,approval=false)=>{const p=c.artisans.find(a=>a.id===uid);return !!p&&(admin||p.paths.some(path=>canAt(ctx,approval?'MNT.WO.close':'MNT.WO.plan',path,s)));};
 const view=(scope:string)=>admin||scope.startsWith('employee:')&&(scope.slice(9)===ctx.uid||manages(scope.slice(9))||manages(scope.slice(9),true))||c.artisans.some(a=>a.id===ctx.uid&&a.scopeKeys.includes(scope));
 if(action==='read'){const items=(await listDocs(col)).filter(d=>view(str(d.data.scope))).sort((a,b)=>str(b.data.start).localeCompare(str(a.data.start))).slice(0,300).map(d=>({...d.data,id:d.id,canDecide:d.data.status==='pending'&&d.data.createdBy!==ctx.uid&&(admin||str(d.data.scope).startsWith('employee:')&&str(d.data.scope).slice(9)!==ctx.uid&&manages(str(d.data.scope).slice(9),true)),canWithdraw:d.data.status==='pending'&&(d.data.createdBy===ctx.uid||admin)}));return {items,scopes:[...(admin?[{id:'org',label:'All organization'},...c.nodes.filter(n=>['country','legal_entity','site','cost_center','work_center'].includes(str(n.data.level))).map(n=>({id:'node:'+n.id,label:str(n.data.name)||n.id})),...[...new Map(c.artisans.filter(a=>a.groupId).map(a=>[a.groupId,{id:'group:'+a.groupId,label:a.groupName}])).values()]]:[]),...c.artisans.filter(a=>a.id===ctx.uid||manages(a.id)||manages(a.id,true)).map(a=>({id:'employee:'+a.id,label:a.name+' · '+a.groupName}))]};}
 const note=str(b.note).trim().slice(0,500);if(note.length<10)throw new HttpError(400,'Provide a reason of at least 10 characters.');
 const at=nowIso();
 if(action==='request'){
  const scope=str(b.scope),kind=str(b.kind),uid=scope.startsWith('employee:')?scope.slice(9):'',start=str(b.start),end=str(b.end);
  if(!['holiday','unavailable','overtime'].includes(kind))throw new HttpError(400,'Choose calendar adjustment type.');
  if(uid){if(uid!==ctx.uid&&!manages(uid))throw new HttpError(403,'Scoped planner or the employee must request.');if(!c.artisans.some(p=>p.id===uid))throw new HttpError(400,'Choose an active artisan.');}else if(!admin||kind!=='holiday'||!(scope==='org'||c.nodes.some(n=>scope==='node:'+n.id)||c.artisans.some(a=>scope==='group:'+a.groupId&&a.groupId)))throw new HttpError(403,'Only organization administration may request shared holidays.');
  if(kind==='holiday'){if(!validDay(start)||!validDay(end)||start>end||Date.parse(end)-Date.parse(start)>92*86400000)throw new HttpError(400,'Choose a holiday range up to 93 days.');}else if(!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>36*3600000)throw new HttpError(400,'Choose an interval up to 36 hours with timezone.');
  const id=randomUUID().replaceAll('-',''),entry={scope,kind,start:kind==='holiday'?start:new Date(start).toISOString(),end:kind==='holiday'?end:new Date(end).toISOString(),status:'pending',note,createdAt:at,createdBy:ctx.uid};
  if(!await writeDoc(col+'/'+id,entry,{exists:false}))throw new HttpError(409,'Calendar request not saved.');
  await audit([{category:'maintenance',action:'mnt.workforce_calendar.request',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:id},details:kind+' · '+note}]);return {ok:true};
 }
 if(!['approve','reject','withdraw'].includes(action)||!/^[a-f0-9]{32}$/.test(str(b.id)))throw new HttpError(400,'Choose a pending calendar request.');
 const d=await getDoc(col+'/'+str(b.id));if(!d||d.data.status!=='pending')throw new HttpError(409,'Calendar request is no longer pending.');
 const scope=str(d.data.scope),uid=scope.startsWith('employee:')?scope.slice(9):'';
 if(action==='withdraw'){if(!admin&&d.data.createdBy!==ctx.uid)throw new HttpError(403,'Only the requester or administrator may withdraw.');}else if(d.data.createdBy===ctx.uid||uid===ctx.uid||!(admin||uid&&manages(uid,true)))throw new HttpError(403,'Independent scoped maintenance approval required.');
 if(action==='approve'&&d.data.kind==='overtime'&&uid){
  const span={start:Date.parse(str(d.data.start)),end:Date.parse(str(d.data.end))};if(c.approvedLeave.some(l=>l.uid===uid&&l.start<=new Date(span.end-1).toISOString().slice(0,10)&&l.end>=new Date(span.start).toISOString().slice(0,10)))throw new HttpError(409,'Overtime cannot override approved HR leave.');
  if((await listDocs(col)).some(x=>x.id!==d.id&&x.data.scope===scope&&x.data.kind==='overtime'&&x.data.status==='approved'&&overlap(span,{start:Date.parse(str(x.data.start)),end:Date.parse(str(x.data.end))})))throw new HttpError(409,'Overtime overlaps an approved request.');
 }
 const status=action==='approve'?'approved':action==='reject'?'rejected':'withdrawn';if(!await writeDoc(col+'/'+d.id,{...d.data,status,decision:{by:ctx.uid,at,note}},{updateTime:d.updateTime}))throw new HttpError(409,'Calendar request changed.');
 await audit([{category:'maintenance',action:'mnt.workforce_calendar.'+action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:d.id},details:note}]);return {ok:true};
}
export const maintenanceWorkforceCalendarRoutes={'POST /api/org/mnt/workforce/calendar':[orgRoute('org.mnt.workforce.calendar','MNT.view',async ctx=>str(ctx.body.action)==='read'?calendarRoute(ctx):withLock(ctx.orgId,'maintenance_operations',()=>calendarRoute(ctx)))]};
