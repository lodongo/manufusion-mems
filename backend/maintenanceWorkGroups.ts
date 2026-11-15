import { HttpError, getDoc, isObj, listDocs, nowIso, str, randomId, type Doc } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { orgUsers } from './org';
import { audit } from './audit';
import { commit, withLock } from './finCore';
import { MNT_ACTIVITIES } from './maintenanceActivities';
import { MAINTENANCE_GATES } from './maintenanceWorkflowConfig';

export const WORK_GROUP_TITLES = ['Maintenance Lead','Maintenance Planner','Maintenance Clerk','Maintenance Specialist','Maintenance Technician'] as const;
type Title = typeof WORK_GROUP_TITLES[number];
type Member = { positionCode:string; uid:string };
type Task = { code:string; label:string; permission:string|null; mode:string; owner:string; separation:string; external:boolean; requires:readonly string[] };
const externalGates = new Set(['MNT.MAT.CREATE','MNT.SPARES.RESERVE','MNT.SHORTAGE.SOURCE','MNT.WO.COST','MNT.SAFETY.SIGNOFF','MNT.HANDOVER']);
const externalPermissions = new Set(['MNT.admin','MNT.WO.costApprove','MNT.WO.safety','MNT.WR.create','MNT.WR.edit','MNT.WR.cancel','MNT.view','MNT.activities.view']);
/** The shipped registries, not a second hand-maintained list. Gates with the same permission remain distinct. */
export const WORK_GROUP_TASKS: Task[] = [
 ...MAINTENANCE_GATES.filter(g=>g.status==='existing').map(g=>({...g,external:externalGates.has(g.code)||g.mode==='automated'})),
 ...MNT_ACTIVITIES.map(a=>({code:a.key,label:a.label,permission:a.key,mode:'security activity',owner:'Security activity registry',separation:'Existing operational and maker-checker controls continue to apply.',external:externalPermissions.has(a.key),requires:[]}))
];
const objects=(v:unknown):Record<string,unknown>[]=>Array.isArray(v)?v.filter(isObj):[];
const strings=(v:unknown):string[]=>Array.isArray(v)?[...new Set(v.map(str).filter(Boolean))]:[];
const uidPattern=/^[A-Za-z0-9_-]{1,128}$/;
const title=(x:string):x is Title=>WORK_GROUP_TITLES.some(t=>t===x);
const groupCol=(orgId:string)=>'organizations/'+orgId+'/maintenance_work_groups';
const nameOf=(d:Doc)=>str(d.data.name)||str(d.data.title)||d.id;
const sequencePath=(orgId:string)=>'organizations/'+orgId+'/maintenance_work_group_sequences/default';
export function nextWorkGroupNumber(prior:unknown, groups:readonly Doc[]):number {
 const last=Math.max(0,Number(prior)||0,...groups.map(g=>{const m=/^WG_(\d+)$/.exec(str(g.data.code));return m?Number(m[1]):0;}));
 if(!Number.isSafeInteger(last)||last<0||last>=Number.MAX_SAFE_INTEGER)throw new HttpError(409,'Work group numbering is exhausted.');
 return last+1;
}

export function workGroupAncestry(nodes:ReadonlyMap<string,Doc>, id:string):string[]{
 const path:string[]=[]; const seen=new Set<string>();
 while(id&&id!=='root'&&!seen.has(id)&&path.length<20){
  const node=nodes.get(id); if(!node||str(node.data.status)==='inactive')return [];
  seen.add(id);path.unshift(id);id=str(node.data.parentId);
 }
 return id&&id!=='root'?[]:path;
}
/** A real active organizational assignment must cover the selected cost center. */
export function workGroupHolder(user:Doc, positionCode:string, costCenterPath:string[], today:string):boolean{
 if(str(user.data.status)==='disabled')return false;
 return objects(user.data.assignments).slice(0,2).some((a,i)=>{
  const kind=i===0?'primary':str(a.type);
  if(kind!=='primary'&&(!['acting','secondment','extended_function'].includes(kind)||!str(a.endsOn)))return false;
  return str(a.positionCode)===positionCode&&costCenterPath.includes(str(a.nodeId))&&
   (!str(a.startsOn)||str(a.startsOn)<=today)&&(!str(a.endsOn)||str(a.endsOn)>=today);
 });
}
/** The work order belongs to the group covering its equipment cost center. A group is a shared
 * staff resource pool across its own cost centers; it is not an authorization grant. */
export async function workGroupResourcePool(orgId:string, record:Doc, suppliedUsers?:Doc[]){
 const root='organizations/'+orgId;
 const [groups,nodes,positions,users]=await Promise.all([listDocs(groupCol(orgId)),listDocs(root+'/structure'),listDocs(root+'/positions'),suppliedUsers?Promise.resolve(suppliedUsers):orgUsers(orgId)]);
 const byNode=new Map(nodes.map(n=>[n.id,n]));
 const recordNode=str(record.data.assemblyId)||str(record.data.unitId)||strings(record.data.path).at(-1)||'';
 const path=workGroupAncestry(byNode,recordNode);
 const siteId=path.find(id=>str(byNode.get(id)?.data.level)==='site');
 const ccId=path.find(id=>str(byNode.get(id)?.data.level)==='cost_center');
 const matched=groups.filter(g=>g.data.status!=='inactive'&&siteId&&ccId&&str(g.data.siteId)===siteId&&strings(g.data.costCenterIds).includes(ccId));
 if(matched.length>1)throw new HttpError(409,'More than one work group covers this cost center. Resolve the configuration before allocating resources.');
 const group=matched[0],today=nowIso().slice(0,10);
 const activeUsers=users.filter(u=>str(u.data.orgId)===orgId&&str(u.data.status)!=='disabled');
 const byUser=new Map(activeUsers.map(u=>[u.id,u]));
 const activePositions=new Map(positions.filter(p=>str(p.data.status)!=='inactive').map(p=>[p.id,p]));
 const members=new Map<string,Set<string>>();
 if(group){
  const costPaths=strings(group.data.costCenterIds).map(id=>workGroupAncestry(byNode,id)).filter(p=>p.includes(siteId!)&&str(byNode.get(p.at(-1)||'')?.data.level)==='cost_center');
  const configured=isObj(group.data.members)?group.data.members:{};
  for(const t of WORK_GROUP_TITLES)for(const m of objects(configured[t])){
   const uid=str(m.uid),role=str(m.positionCode),u=byUser.get(uid);
   if(!u||!activePositions.has(role)||!costPaths.some(p=>workGroupHolder(u,role,p,today)))continue;
   const titles=members.get(uid)||new Set<string>();titles.add(t);members.set(uid,titles);
  }
 }
 return {
  group:group?{id:group.id,code:str(group.data.code),name:str(group.data.name),version:Number(group.data.version)||0}:null,
  people:activeUsers.map(u=>({id:u.id,name:(str(u.data.firstName)+' '+str(u.data.lastName)).trim()||str(u.data.displayName)||u.id,inWorkGroup:members.has(u.id),genericTitles:[...(members.get(u.id)||[])]})).sort((a,b)=>a.name.localeCompare(b.name)),
 };
}
export function requireOutsideGroupOptIn(ids:readonly string[], people:ReadonlyArray<{id:string;inWorkGroup:boolean}>, includeOutside:unknown):string[]{
 const eligible=new Map(people.map(p=>[p.id,p]));
 if(ids.some(id=>!eligible.has(id)))throw new HttpError(400,'Choose active employees in this organization.');
 const outside=ids.filter(id=>!eligible.get(id)?.inWorkGroup);
 if(outside.length&&includeOutside!==true)throw new HttpError(403,'Enable Include employees outside the work group and deliberately select those employees before saving.');
 return outside;
}
function assertAdmin(ctx:OrgContext){
 if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'Maintenance Management is not enabled.');
 if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'ADM.workflows'))throw new HttpError(403,'Workflow administration is required.');
}
async function setup(ctx:OrgContext){
 const [nodes,positions,users,groups]=await Promise.all([listDocs('organizations/'+ctx.orgId+'/structure'),listDocs('organizations/'+ctx.orgId+'/positions'),orgUsers(ctx.orgId),listDocs(groupCol(ctx.orgId))]);
 return {nodes:new Map(nodes.map(n=>[n.id,n])),positions:new Map(positions.filter(p=>str(p.data.status)!=='inactive').map(p=>[p.id,p])),users:new Map(users.filter(u=>str(u.data.status)!=='disabled').map(u=>[u.id,u])),groups};
}
export function assessWorkGroup(members:Record<string,Member[]>, tasks:Record<string,string[]>, ccPaths:string[][], users:ReadonlyMap<string,Doc>, today:string){
 const issues:string[]=[];
 for(const t of WORK_GROUP_TITLES){
  if(!(members[t]||[]).length)issues.push('Assign at least one named employee to '+t+'.');
  for(const path of ccPaths)if(!(members[t]||[]).some(m=>{const u=users.get(m.uid);return !!u&&workGroupHolder(u,m.positionCode,path,today);}))
   issues.push(t+' has no eligible holder for cost center '+path[path.length-1]+'.');
 }
 for(const task of WORK_GROUP_TASKS.filter(t=>!t.external))if(!(tasks[task.code]||[]).length)issues.push('Allocate '+task.code+' to a generic role.');
 // Avoid treating distinct titles as distinct people. Warn if all assessment makers and checkers overlap.
 const who=(code:string)=>new Set((tasks[code]||[]).flatMap(t=>(members[t]||[]).map(m=>m.uid)));
 const makers=who('MNT.assessment.edit'),checkers=who('MNT.ASSESS.REVIEW');
 if(makers.size&&checkers.size&&![...makers].some(m=>[...checkers].some(c=>m!==c)))issues.push('Assessment and independent approval require different people.');
 const effective=WORK_GROUP_TASKS.filter(t=>!t.external).map(t=>({code:t.code,permission:t.permission,positions:[...new Set((tasks[t.code]||[]).flatMap(k=>(members[k]||[]).map(m=>m.positionCode)))],employees:[...who(t.code)]}));
 return {issues,effective,ready:issues.length===0};
}
export const maintenanceWorkGroupRoutes={
 'POST /api/org/mnt/work-groups': [orgRoute('org.mnt.workGroups.list', 'ADM.workflows', async ctx=>{
  assertAdmin(ctx);const d=await setup(ctx);
  const sites=[...d.nodes.values()].filter(n=>str(n.data.level)==='site'&&workGroupAncestry(d.nodes,n.id).length).map(n=>({id:n.id,label:nameOf(n),code:str(n.data.code)}));
  const cc=[...d.nodes.values()].filter(n=>str(n.data.level)==='cost_center').flatMap(n=>{
   const path=workGroupAncestry(d.nodes,n.id),site=path.find(id=>str(d.nodes.get(id)?.data.level)==='site');
   return site?[{id:n.id,siteId:site,label:nameOf(n),code:str(n.data.code),path}]:[];
  });
  const today=nowIso().slice(0,10);
  const staff=[...d.users.values()].flatMap(u=>objects(u.data.assignments).slice(0,2).flatMap(a=>{
   const role=str(a.positionCode);if(!d.positions.has(role))return [];
   const costCenterIds=cc.filter(c=>workGroupHolder(u,role,c.path,today)).map(c=>c.id);
   return costCenterIds.length?[{uid:u.id,positionCode:role,name:(str(u.data.firstName)+' '+str(u.data.lastName)).trim()||str(u.data.displayName)||str(u.data.email)||u.id,costCenterIds}]:[];
  }));
  const groups=d.groups.map(g=>{
   const members=(isObj(g.data.members)?g.data.members:{}) as Record<string,Member[]>;
   const tasks=(isObj(g.data.tasks)?g.data.tasks:{}) as Record<string,string[]>;
   const paths=strings(g.data.costCenterIds).map(id=>workGroupAncestry(d.nodes,id)).filter(p=>p.length);
   return {id:g.id,...g.data,...assessWorkGroup(members,tasks,paths,d.users,today)};
  });
  return {titles:WORK_GROUP_TITLES,tasks:WORK_GROUP_TASKS,sites,costCenters:cc.map(({path,...x})=>x),positions:[...d.positions.values()].map(p=>({id:p.id,label:nameOf(p)})),staff,groups,authorizationMode:'legacy'};
 })],
 'POST /api/org/mnt/work-groups/save': [orgRoute('org.mnt.workGroups.save','ADM.workflows',async ctx=>withLock(ctx.orgId,'maintenance_work_groups',async()=>{
  assertAdmin(ctx);const d=await setup(ctx),body=ctx.body;
  const name=str(body.name).trim().slice(0,120),siteId=str(body.siteId),costCenterIds=strings(body.costCenterIds);
  if(name.length<3)throw new HttpError(400,'Enter a work group name (at least 3 characters).');
  if(str(d.nodes.get(siteId)?.data.level)!=='site'||!workGroupAncestry(d.nodes,siteId).length)throw new HttpError(400,'Choose an active site.');
  if(!costCenterIds.length||costCenterIds.length>150)throw new HttpError(400,'Choose 1–150 cost centers.');
  const paths=costCenterIds.map(id=>{const p=workGroupAncestry(d.nodes,id);if(str(d.nodes.get(id)?.data.level)!=='cost_center'||!p.includes(siteId))throw new HttpError(400,'All cost centers must belong to the selected site.');return p;});
  const requested=str(body.id);if(requested&&!uidPattern.test(requested))throw new HttpError(400,'Invalid work group.');
  const prior=requested?d.groups.find(g=>g.id===requested):undefined;
  if(requested&&!prior)throw new HttpError(404,'Work group not found.');
  if(Number(body.expectedVersion)!==(Number(prior?.data.version)||0))throw new HttpError(409,'Work group has changed. Reload first.');
  for(const g of d.groups.filter(x=>x.id!==requested)){
   if(strings(g.data.costCenterIds).some(id=>costCenterIds.includes(id)))throw new HttpError(409,'A cost center already belongs to work group '+str(g.data.name)+'.');
  }
  if(!isObj(body.members)||!isObj(body.tasks))throw new HttpError(400,'Role and task mappings are required.');
  if(Object.keys(body.members).some(k=>!title(k)))throw new HttpError(400,'Unknown generic maintenance title.');
  const today=nowIso().slice(0,10),members:Record<string,Member[]>={};
  for(const t of WORK_GROUP_TITLES){
   const raw=objects(body.members[t]);if(raw.length>100)throw new HttpError(400,'Maximum 100 members per generic title.');
   const seen=new Set<string>();members[t]=[];
   for(const m of raw){
    const positionCode=str(m.positionCode),uid=str(m.uid),u=d.users.get(uid);
    if(!d.positions.has(positionCode)||!u||!paths.some(p=>workGroupHolder(u,positionCode,p,today)))throw new HttpError(400,'A named employee must hold the selected organization role within the work group.');
    const key=positionCode+'|'+uid;if(!seen.has(key)){seen.add(key);members[t].push({positionCode,uid});}
   }
  }
  const tasks:Record<string,string[]>={};
  for(const [k,v] of Object.entries(body.tasks)){
   const task=WORK_GROUP_TASKS.find(t=>t.code===k);if(!task)throw new HttpError(400,'Unknown maintenance task '+k+'.');
   const titles=strings(v);
   if(titles.some(x=>!title(x))||task.external&&titles.length)throw new HttpError(400,'Invalid role allocation or externally governed task.');
   if(!task.external)tasks[k]=titles;
  }
  const reason=str(body.reason).trim().slice(0,500);if(reason.length<10)throw new HttpError(400,'Enter a reason of at least 10 characters.');
  const assessment=assessWorkGroup(members,tasks,paths,d.users,today);
  const id=requested||randomId(16),version=(Number(prior?.data.version)||0)+1;
  const counter=prior?null:await getDoc(sequencePath(ctx.orgId));
  const number=prior?0:nextWorkGroupNumber(counter?.data.lastNumber,d.groups);
  const code=prior?str(prior.data.code):'WG_'+String(number).padStart(4,'0');
  const fields={code,name,siteId,costCenterIds,members,tasks,version,status:'draft',reason,updatedAt:nowIso(),updatedBy:ctx.uid,createdAt:prior?.data.createdAt||nowIso(),createdBy:prior?.data.createdBy||ctx.uid};
  const groupWrite={path:groupCol(ctx.orgId)+'/'+id,fields,...(prior?{updateTime:prior.updateTime}:{exists:false})};
  if(prior)await commit([groupWrite]);
  else await commit([groupWrite,{path:sequencePath(ctx.orgId),fields:{lastNumber:number,updatedAt:nowIso()},...(counter?{updateTime:counter.updateTime}:{exists:false})}]);
  await audit([{category:'maintenance',action:'mnt.work_group.draft_saved',actor:ctx.actor,meta:ctx.meta,target:{label:code},orgId:ctx.orgId,details:reason+'; revision '+version}]);
  return {id,code,version,...assessment,authorizationMode:'legacy'};
 }))],
};
