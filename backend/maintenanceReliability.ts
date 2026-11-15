import {randomUUID} from 'node:crypto';
import {getDoc,listDocs,writeDoc,str,isObj,nowIso,HttpError,type Doc} from './core';
import {orgRoute,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {withLock} from './finCore';
import {audit} from './audit';
import {ancestry} from './maintenanceWorkGroupPolicy';
import {resolveMaintenanceEquipmentAsset} from './maintenanceAssetLink';
import {validDay} from './maintenanceCapacityCore';
import {midnight} from './maintenanceAnalyticsCalendar';
import {dateAdd} from './maintenanceAnalyticsCore';
import {reliabilityMetrics,validateObservation,type Observation,type Failure} from './maintenanceReliabilityCore';
const obj=(v:unknown)=>isObj(v)?v:{};
const arr=(v:unknown)=>Array.isArray(v)?v.filter(isObj):[];
const txt=(v:unknown)=>Array.isArray(v)?v.map(str).filter(Boolean):[];
const obs=(d:Doc):Observation=>({from:str(d.data.from),through:str(d.data.through),plannedHours:Number(d.data.plannedHours),operatingHours:Number(d.data.operatingHours),status:str(d.data.status),failures:arr(d.data.failures).map(f=>({id:str(f.id),orderCode:str(f.orderCode),startedAt:str(f.startedAt),restoredAt:str(f.restoredAt),repairHours:typeof f.repairHours==='number'?f.repairHours:null,mode:str(f.mode),strategy:str(f.strategy)}))});
const idValid=(v:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(v);
async function reliability(ctx:OrgContext){
 if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'Maintenance is not enabled.');
 const b=ctx.body,action=str(b.action)||'read',root='organizations/'+ctx.orgId,col=root+'/maintenance_reliability_observations',scope=await scopeOf(ctx);
 const [nodes,assets,orders,all,documents]=await Promise.all(['structure','assets','work_orders','maintenance_reliability_observations','drkms_documents'].map(c=>listDocs(root+'/'+c))),byId=new Map(nodes.map(n=>[n.id,n]));
 const equipment=nodes.filter(n=>['equipment','work_center'].includes(str(n.data.level))&&n.data.status!=='inactive').flatMap(n=>{const path=ancestry(byId,n.id);if(!path.length||!canAt(ctx,'MNT.view',path,scope))return [];let tag='';try{tag=resolveMaintenanceEquipmentAsset(n.id,str(obj(n.data.attributes).assetTag),assets.map(a=>({id:a.id,status:str(a.data.status),workCenterId:str(a.data.workCenterId)})));}catch{return [];}const legal=path.find(id=>byId.get(id)?.data.level==='legal_entity')||'',le=byId.get(legal);const zone=str(obj(le?.data.attributes).timeZone)||str(le?.data.timeZone)||str(ctx.org.data.timeZone)||str(ctx.org.data.timezone)||'UTC';return [{id:n.id,tag,path,legal,zone,name:str(n.data.name)||n.id,code:str(n.data.code),canRequest:canAt(ctx,'MNT.WO.plan',path,scope),canApprove:canAt(ctx,'MNT.WO.close',path,scope)}];});
 const selected=equipment.filter(e=>(!b.node||e.path.includes(str(b.node)))&&(!b.legalEntity||e.legal===b.legalEntity)&&(!b.asset||e.tag===b.asset||e.id===b.asset)&&(!b.equipmentId||e.id===b.equipmentId));
 const ordersVisible=orders.filter(w=>canAt(ctx,'MNT.view',txt(w.data.path),scope));
 if(action==='read'){
  const from=str(b.from),through=str(b.through);
  if(!validDay(from)||!validDay(through)||from>through||Date.parse(through)-Date.parse(from)>366*86400000)throw new HttpError(400,'Choose a reporting range up to 367 days.');
  const data=selected.map(e=>{const source=all.filter(o=>o.data.equipmentId===e.id&&o.data.assetTag===e.tag),metrics=reliabilityMetrics(source.map(obs),from,through),wos=ordersVisible.filter(w=>w.data.unitId===e.id&&w.data.assetTag===e.tag),ids=new Set(wos.map(w=>w.id)),wr=new Set(wos.map(w=>str(w.data.wrCode)).filter(Boolean));const relevant=documents.filter(d=>d.data.subtypeCode==='RCA'&&obj(d.data.trigger).verification==='linked'&&((obj(d.data.trigger).typeCode==='MNT_BREAKDOWN'&&ids.has(str(obj(d.data.trigger).recordId)))||(obj(d.data.trigger).typeCode==='MNT_REQUEST'&&wr.has(str(obj(d.data.trigger).recordId)))));
  const events=source.filter(o=>o.data.status==='approved'&&str(o.data.from)>=from&&str(o.data.through)<=through).flatMap(o=>obs(o).failures);const strategy=new Map<string,{strategy:string;failures:number;downtime:number}>();for(const event of events){const k=event.strategy||'Unclassified',v=strategy.get(k)||{strategy:k,failures:0,downtime:0};v.failures++;v.downtime+=(Date.parse(event.restoredAt)-Date.parse(event.startedAt))/3600000;strategy.set(k,v);}
  return {...e,...metrics,rcaCount:relevant.filter(d=>d.data.status==='published').length,rcaTotal:relevant.length,strategies:[...strategy.values()],events,observations:source.filter(o=>str(o.data.from)<=through&&str(o.data.through)>=from).map(o=>({id:o.id,...obs(o),reference:str(o.data.reference),canDecide:o.data.status==='pending'&&o.data.createdBy!==ctx.uid&&e.canApprove})),orders:e.canRequest?wos.map(w=>({id:w.id,label:w.id+' · '+str(w.data.title),wrCode:str(w.data.wrCode)})):[]};
  }).sort((a,b)=>(b.failureDowntime??-1)-(a.failureDowntime??-1));
  return {equipment:data,from,through,coverage:'Only independently approved, complete nonoverlapping operating-time observations support MTBF, MTTR and availability. Linked maintenance WO/WR failures are not inferred from downtime or work order elapsed time. Failure-mode repeats are counted as repeated classifications, not automatically verified same-root-cause events. Manufacturing runtime ingestion is not available in this repository; transcribe trusted shift/OEE records and retain their references.'};
 }
 const note=str(b.note).trim().slice(0,500);if(note.length<10)throw new HttpError(400,'Provide a reason or evidence note (10+ characters).');
 if(action==='request'){
  const e=selected.find(x=>x.id===b.equipmentId);if(!e||!e.canRequest)throw new HttpError(403,'Scoped maintenance planning authority required.');
  const from=str(b.from),through=str(b.through),start=midnight(from,e.zone),end=midnight(dateAdd(through,1),e.zone);
  if(!validDay(from)||!validDay(through)||from>through||Date.parse(through)-Date.parse(from)>92*86400000||end>Date.now())throw new HttpError(400,'Choose up to 93 completed reporting days.');
  const reference=str(b.reference).trim().slice(0,300);if(reference.length<3)throw new HttpError(400,'Enter the production or equipment runtime evidence reference.');
  const failures:Failure[]=arr(b.failures).map(f=>{const w=ordersVisible.find(w=>w.id===f.orderCode&&w.data.unitId===e.id&&w.data.assetTag===e.tag);if(!w)throw new HttpError(400,'Each failure must link to an accessible work order on this equipment.');const id=str(w.data.wrCode)||str(w.data.rootWoCode)||w.id;const mode=str(w.data.failureModeLabel)||str(obj(w.data.directCompletion).failureModeLabel)||str(w.data.natureLabel)||'Unclassified';return {id,orderCode:w.id,startedAt:str(f.startedAt),restoredAt:str(f.restoredAt),repairHours:f.repairHours===null?null:typeof f.repairHours==='number'?f.repairHours:NaN,mode,strategy:str(w.data.maintenanceTypeLabel)||'Unclassified'};});
  if(failures.length>100)throw new HttpError(400,'Maximum 100 failure events per observation.');
  const o={from,through,plannedHours:typeof b.plannedHours==='number'?b.plannedHours:NaN,operatingHours:typeof b.operatingHours==='number'?b.operatingHours:NaN,failures,status:'pending'};
  try{validateObservation(o,start,end);}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid operating observation');}
  if(all.some(d=>d.data.assetTag===e.tag&&['pending','approved'].includes(str(d.data.status))&&str(d.data.from)<=through&&str(d.data.through)>=from))throw new HttpError(409,'Existing pending or approved observation overlaps this interval.');
  if(all.some(d=>d.data.assetTag===e.tag&&['pending','approved'].includes(str(d.data.status))&&obs(d).failures.some(f=>failures.some(x=>x.id===f.id))))throw new HttpError(409,'A linked failure has already been recorded.');
  const id=randomUUID().replaceAll('-','');await writeDoc(col+'/'+id,{...o,equipmentId:e.id,assetTag:e.tag,path:e.path,zone:e.zone,reference,note,createdAt:nowIso(),createdBy:ctx.uid},{exists:false});await audit([{category:'maintenance',action:'mnt.reliability.requested',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:id},details:reference}]);return {ok:true};
 }
 if(!['approve','reject'].includes(action)||!idValid(str(b.id)))throw new HttpError(400,'Choose a pending observation.');
 const d=all.find(x=>x.id===b.id),e=equipment.find(x=>x.id===d?.data.equipmentId&&x.tag===d?.data.assetTag);
 if(!d||d.data.status!=='pending'||!e||!e.canApprove||d.data.createdBy===ctx.uid)throw new HttpError(403,'Independent maintenance closure authority required.');
 if(action==='approve'&&all.some(x=>x.id!==d.id&&x.data.assetTag===e.tag&&x.data.status==='approved'&&str(x.data.from)<=str(d.data.through)&&str(x.data.through)>=str(d.data.from)))throw new HttpError(409,'An approved observation overlaps this period.');
 if(!await writeDoc(col+'/'+d.id,{...d.data,status:action==='approve'?'approved':'rejected',decision:{by:ctx.uid,at:nowIso(),note}},{updateTime:d.updateTime}))throw new HttpError(409,'Observation changed.');
 await audit([{category:'maintenance',action:'mnt.reliability.'+action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:d.id},details:note}]);return {ok:true};
}
export const maintenanceReliabilityRoutes={'POST /api/org/mnt/reliability':[orgRoute('org.mnt.reliability','MNT.view',async ctx=>str(ctx.body.action)==='read'?reliability(ctx):withLock(ctx.orgId,'maintenance_operations',()=>reliability(ctx)))]};
