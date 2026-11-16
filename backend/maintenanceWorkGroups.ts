import {cyclePath,getMaintenanceCycle,validZone} from './maintenanceCycle';
import { HttpError, getDoc, isObj, listDocs, nowIso, str, randomId, type Doc } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { orgUsers } from './org';
import { audit,buildAudit } from './audit';
import {bypass} from './testModeCore';
import { commit, withLock } from './finCore';
import { CURRENT_MNT_ACTIVITIES as MNT_ACTIVITIES } from './maintenanceActivities';
import { MAINTENANCE_GATES,RETIRED_MAINTENANCE_KEYS } from './maintenanceWorkflowConfig';

import {WORK_GROUP_TITLES,externalGates,externalPermissions,DEFAULT_WORK_GROUP_TASKS,activeWorkGroupPath,type ActiveWorkGroups,type ActiveGroup} from './maintenanceWorkGroupPolicy';
export {WORK_GROUP_TITLES} from './maintenanceWorkGroupPolicy';
type Title = typeof WORK_GROUP_TITLES[number];
type Member = { positionCode:string; uid:string };
type Task = { code:string; label:string; permission:string|null; mode:string; owner:string; separation:string; external:boolean; requires:readonly string[] };
/** The shipped registries, not a second hand-maintained list. Gates with the same permission remain distinct. */
export const WORK_GROUP_TASKS: Task[] = [
 ...MAINTENANCE_GATES.filter(g=>g.status==='existing').map(g=>({...g,external:externalGates.has(g.code)||g.mode==='automated'})),
 ...MNT_ACTIVITIES.map(a=>({code:a.key,label:a.label,permission:a.key,mode:'security activity',owner:'Security activity registry',separation:'Existing operational and maker-checker controls continue to apply.',external:externalPermissions.has(a.key),requires:[]}))
];
// One-to-one task gates and security activities are one allocation, not two independent settings.
export const LINKED_WORK_GROUP_TASKS:readonly (readonly [string,string])[]=[
 ['MNT.WR.CREATE','MNT.WR.create'],['MNT.WR.REVIEW','MNT.WR.review'],['MNT.WR.APPROVAL','MNT.WR.approve'],['MNT.WO.CLOSE_APPROVAL','MNT.WO.technicalApprove'],
 ['MNT.WR.ASSESS','MNT.assessment.edit'],['MNT.ASSESS.REVIEW','MNT.assessment.review'],
 ['MNT.WR.CONVERT','MNT.WR.convert'],['MNT.WINDOW.LOCK','MNT.WO.schedule'],
 ['MNT.TASK.FEEDBACK','MNT.WO.execute']
];
const objects=(v:unknown):Record<string,unknown>[]=>Array.isArray(v)?v.filter(isObj):[];
const strings=(v:unknown):string[]=>Array.isArray(v)?[...new Set(v.map(str).filter(Boolean))]:[];
const uidPattern=/^[A-Za-z0-9_-]{1,128}$/;
const title=(x:string):x is Title=>WORK_GROUP_TITLES.some(t=>t===x);
const groupCol=(orgId:string)=>'organizations/'+orgId+'/maintenance_work_groups';
const nameOf=(d:Doc)=>str(d.data.name)||str(d.data.title)||d.id;
const sequencePath=(orgId:string)=>'organizations/'+orgId+'/maintenance_work_group_sequences/default';
const masterPath=(orgId:string)=>'organizations/'+orgId+'/maintenance_work_group_settings/default';
const memberIds=(value:unknown):string[]=>isObj(value)?[...new Set(Object.values(value).flatMap(ms=>objects(ms).map(m=>str(m.uid)).filter(Boolean)))]:[];
export const mapOfStrings=(value:unknown):Record<string,string[]>=>isObj(value)?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,strings(v)])):{};
export function memberMap(value:unknown):Record<string,Member[]>{
 return Object.fromEntries(WORK_GROUP_TITLES.map(t=>[t,objects(isObj(value)?value[t]:null).map(m=>({uid:str(m.uid),positionCode:str(m.positionCode)})).filter(m=>m.uid&&m.positionCode)]));
}
export function workGroupConflicts(groups:readonly Doc[], groupId:string, costCenterIds:readonly string[], members:unknown):string[]{
 const ids=new Set(memberIds(members));const issues:string[]=[];
 for(const g of groups.filter(x=>x.id!==groupId)){
  const label=str(g.data.code)+' · '+str(g.data.name);
  for(const cc of strings(g.data.costCenterIds).filter(x=>costCenterIds.includes(x)))issues.push('Cost center '+cc+' already belongs to '+label+'.');
  for(const uid of memberIds(g.data.members).filter(x=>ids.has(x)))issues.push('Employee '+uid+' already belongs to '+label+'. Remove the existing assignment before transferring.');
 }
 return issues;
}
export function mergedMasterTasks(master:Doc|undefined){
 const saved=mapOfStrings(master?.data.tasks);
 return Object.fromEntries(WORK_GROUP_TASKS.filter(t=>!t.external).map(t=>[t.code,Number(master?.data.defaultsVersion)===1&&Object.prototype.hasOwnProperty.call(saved,t.code)?saved[t.code]:saved[t.code]?.length?saved[t.code]:DEFAULT_WORK_GROUP_TASKS[t.code]||[]]));
}
function suggestedMaster(groups:readonly Doc[],positions:ReadonlyMap<string,Doc>){
 const roleAlignment:Record<string,string[]>={},tasks:Record<string,string[]>={};
 for(const t of WORK_GROUP_TITLES)roleAlignment[t]=[...new Set(groups.flatMap(g=>memberMap(g.data.members)[t].map(m=>m.positionCode)).filter(id=>positions.has(id)))];
 for(const task of WORK_GROUP_TASKS.filter(t=>!t.external)){const prior=[...new Set(groups.flatMap(g=>mapOfStrings(g.data.tasks||g.data.legacyTasks)[task.code]||[]).filter(title))];tasks[task.code]=prior.length?prior:[...(DEFAULT_WORK_GROUP_TASKS[task.code]||[])];}
 return {roleAlignment,tasks};
}
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
 const [draftGroups,nodes,positions,users,master,active]=await Promise.all([listDocs(groupCol(orgId)),listDocs(root+'/structure'),listDocs(root+'/positions'),suppliedUsers?Promise.resolve(suppliedUsers):orgUsers(orgId),getDoc(masterPath(orgId)),getDoc(activeWorkGroupPath(orgId))]);
 const live=active?.data as unknown as ActiveWorkGroups|undefined;
 const liveGroups=(live?.groups||[]).map(g=>({id:g.id,data:g,updateTime:''} as unknown as Doc));
 const groups=[...liveGroups,...draftGroups.filter(g=>!liveGroups.some(a=>a.id===g.id)).filter(g=>!liveGroups.some(a=>strings(a.data.costCenterIds).some(cc=>strings(g.data.costCenterIds).includes(cc))))];
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
  const alignment=liveGroups.some(g=>g.id===group.id)?mapOfStrings(live?.roleAlignment):mapOfStrings(master?.data.roleAlignment);
  const otherMembers=new Set(groups.filter(g=>g.id!==group.id).flatMap(g=>memberIds(g.data.members)));
  for(const t of WORK_GROUP_TITLES)for(const m of objects(configured[t])){
   const uid=str(m.uid),role=str(m.positionCode),u=byUser.get(uid);
   if(!u||otherMembers.has(uid)||!activePositions.has(role)||(master&&!(alignment[t]||[]).includes(role))||!costPaths.some(p=>workGroupHolder(u,role,p,today)))continue;
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
 const [nodes,positions,users,groups,master,active]=await Promise.all([listDocs('organizations/'+ctx.orgId+'/structure'),listDocs('organizations/'+ctx.orgId+'/positions'),orgUsers(ctx.orgId),listDocs(groupCol(ctx.orgId)),getDoc(masterPath(ctx.orgId)),getDoc(activeWorkGroupPath(ctx.orgId))]);
 return {nodes:new Map(nodes.map(n=>[n.id,n])),positions:new Map(positions.filter(p=>str(p.data.status)!=='inactive').map(p=>[p.id,p])),users:new Map(users.filter(u=>str(u.data.status)!=='disabled').map(u=>[u.id,u])),groups,master,active};
}
export function assessWorkGroup(members:Record<string,Member[]>, tasks:Record<string,string[]>, ccPaths:string[][], users:ReadonlyMap<string,Doc>, today:string){
 const issues:string[]=[];
 for(const t of WORK_GROUP_TITLES){
  if(!(members[t]||[]).length)issues.push('Assign at least one named employee to '+t+'.');
  else if(!ccPaths.some(path=>(members[t]||[]).some(m=>{const u=users.get(m.uid);return !!u&&workGroupHolder(u,m.positionCode,path,today);})))issues.push(t+' has no current eligible holder within the group.');
 }
 for(const task of WORK_GROUP_TASKS.filter(t=>!t.external&&!['MNT.WR.APPROVAL','MNT.WR.approve','MNT.WO.CLOSE_APPROVAL','MNT.WO.technicalApprove'].includes(t.code)))if(!(tasks[task.code]||[]).length)issues.push('Allocate '+task.code+' to a generic role.');
 // Avoid treating distinct titles as distinct people. Warn if all assessment makers and checkers overlap.
 const who=(code:string)=>new Set((tasks[code]||[]).flatMap(t=>(members[t]||[]).map(m=>m.uid)));
 const makers=who('MNT.assessment.edit'),checkers=who('MNT.ASSESS.REVIEW');
 if(makers.size&&checkers.size&&![...makers].some(m=>[...checkers].some(c=>m!==c)))issues.push('Assessment and independent approval require different people.');
 const effective=WORK_GROUP_TASKS.filter(t=>!t.external).map(t=>({code:t.code,permission:t.permission,positions:[...new Set((tasks[t.code]||[]).flatMap(k=>(members[k]||[]).map(m=>m.positionCode)))],employees:[...who(t.code)]}));
 return {issues,effective,ready:issues.length===0};
}
/** Publish only saved revisions. An independent checker approves all selected groups under one identical master snapshot. */
async function publishWorkGroups(ctx:OrgContext){
 assertAdmin(ctx);const d=await setup(ctx),b=ctx.body;
 const testing=ctx.role==='org_super_admin'&&ctx.testMode===true;
 const relaxed=(rule:string)=>testing&&bypass(ctx,rule);
 const readinessWarnings:string[]=[];
 const old=d.active?.data as unknown as ActiveWorkGroups|undefined;
 const version=Number(old?.version)||0,masterVersion=Number(d.master?.data.version)||0;
 if(Number(b.expectedActiveVersion)!==version||Number(b.expectedMasterVersion)!==masterVersion||!masterVersion)throw new HttpError(409,'Save or reload master and active configuration.');
 const ids=strings(b.groupIds);
 if(!ids.length||ids.length>150)throw new HttpError(400,'Select 1–150 saved work groups.');
 if((old?.groups||[]).some(g=>!ids.includes(g.id)))throw new HttpError(409,'Existing active groups must be included; transfer their staffing or cost centers using saved drafts.');
 if(!isObj(b.groupVersions))throw new HttpError(400,'Group revision confirmation is required.');
 const note=str(b.reason).trim().slice(0,500);
 if(note.length<10&&!relaxed('mnt.work_group.publish.approval_notes'))throw new HttpError(400,'Enter approval notes (at least 10 characters).');
 const reason=note||'Development test-mode activation';
 if(str(d.master?.data.updatedBy)===ctx.uid&&old?.masterVersion!==masterVersion&&!relaxed('mnt.work_group.publish.master_maker_checker'))throw new HttpError(403,'A different workflow administrator must approve the master revision.');
 const roleAlignment=mapOfStrings(d.master?.data.roleAlignment),tasks=mergedMasterTasks(d.master||undefined);
 const selected:ActiveGroup[]=[];
 const today=nowIso().slice(0,10);
 for(const id of ids){
  const g=d.groups.find(x=>x.id===id);if(!g||Number(b.groupVersions[id])!==Number(g.data.version))throw new HttpError(409,'A selected group changed. Reload before approving.');
  if(str(g.data.updatedBy)===ctx.uid&&!(old?.groups||[]).some(a=>a.id===id&&a.version===Number(g.data.version))&&!relaxed('mnt.work_group.publish.group_maker_checker:'+id))throw new HttpError(403,'A different workflow administrator must approve '+str(g.data.code)+'.');
  const members=memberMap(g.data.members),costCenterIds=strings(g.data.costCenterIds),siteId=str(g.data.siteId);
  const paths=costCenterIds.map(cc=>workGroupAncestry(d.nodes,cc));
  if(str(d.nodes.get(siteId)?.data.level)!=='site'||!workGroupAncestry(d.nodes,siteId).length||paths.some(p=>!p.includes(siteId)||str(d.nodes.get(p.at(-1)||'')?.data.level)!=='cost_center'))throw new HttpError(409,'Configure valid site and cost centers for '+str(g.data.code)+'.');
  if(!paths.length){if(!relaxed('mnt.work_group.publish.missing_cost_centers:'+id))throw new HttpError(409,'Configure valid cost centers for '+str(g.data.code)+'.');readinessWarnings.push(str(g.data.code)+': no cost centers; grants apply nowhere.');}
  const issues=assessWorkGroup(members,tasks,paths,d.users,today).issues;
  for(const t of WORK_GROUP_TITLES)for(const m of members[t])if(!d.positions.has(m.positionCode)||!(roleAlignment[t]||[]).includes(m.positionCode)||!paths.some(p=>{const u=d.users.get(m.uid);return !!u&&workGroupHolder(u,m.positionCode,p,today);}))issues.push('Invalid current employee alignment '+m.uid+' / '+t+'.');
  const conflicts=workGroupConflicts(d.groups,g.id,costCenterIds,members);
  if(conflicts.length)throw new HttpError(409,conflicts[0]);
  for(const pair of [['MNT.WR.REVIEW','MNT.WR.review'],['MNT.ASSESS.REVIEW','MNT.assessment.review'],['MNT.WR.ASSESS','MNT.assessment.edit'],['MNT.WR.CONVERT','MNT.WR.convert'],['MNT.WO.PLAN','MNT.WO.plan'],['MNT.WO.RELEASE','MNT.WO.plan'],['MNT.WINDOW.LOCK','MNT.WO.schedule'],['MNT.TASK.FEEDBACK','MNT.WO.execute'],['MNT.TASK.VALIDATE','MNT.activities.edit'],['MNT.WR.CLOSE','MNT.WR.review']]){
   const holders=(tasks[pair[0]]||[]).filter(t=>(tasks[pair[1]]||[]).includes(t)).flatMap(t=>members[t]||[]);
   if(!holders.length)issues.push('No named holder has both '+pair[0]+' and '+pair[1]+'.');
  }
  if(issues.length){if(!relaxed('mnt.work_group.publish.readiness:'+id))throw new HttpError(409,str(g.data.code)+': '+issues[0]);readinessWarnings.push(...issues.map(i=>str(g.data.code)+': '+i));}
  selected.push({id,code:str(g.data.code),name:str(g.data.name),siteId,version:Number(g.data.version),costCenterIds,members});
 }
 // Do not invalidate a prior approval, named reviewer or approved maintenance window in place.
 // New/changed authorization revisions are applied only across drained affected locations.
 const masterChanged=old?.masterVersion!==masterVersion;
 const changedGroups=selected.filter(g=>masterChanged||!old?.groups.some(a=>a.id===g.id&&a.version===g.version));
 const changed=new Set([...changedGroups.flatMap(g=>g.costCenterIds),...(old?.groups||[]).filter(g=>changedGroups.some(a=>a.id===g.id)).flatMap(g=>g.costCenterIds)]);
 const root='organizations/'+ctx.orgId;
 const [requests,orders]=await Promise.all([listDocs(root+'/work_requests'),listDocs(root+'/work_orders')]);
 const inAffected=(d:Doc)=>strings(d.data.path).some(id=>changed.has(id))||changed.has(str(d.data.costCenterId));
 const openOrders=orders.filter(d=>inAffected(d)&&!['closed','cancelled'].includes(str(d.data.status)));
 const terminal=new Set(['closed','cancelled','declined','converted']);
 const openRequests=requests.filter(d=>inAffected(d)&&!terminal.has(str(d.data.status))&&!str(d.data.woCode));
 const openTransactionIds=[...openRequests,...openOrders].map(d=>d.id);
 if(openTransactionIds.length&&!relaxed('mnt.work_group.publish.open_transaction_cutover'))throw new HttpError(409,'Complete or cancel open maintenance transactions before cutover: '+openTransactionIds.slice(0,8).join(', ')+'. No transaction was changed.');
 const config:ActiveWorkGroups={version:version+1,masterVersion,roleAlignment,tasks,groups:selected};
 if(JSON.stringify(config).length>650000)throw new HttpError(409,'Active configuration exceeds safe database document size.');
 const rules=(ctx.bypassed||[]).filter(r=>r.startsWith('mnt.work_group.publish.'));
 const override=rules.length>0;
 const fields={...config,approvedBy:ctx.uid,approvedAt:nowIso(),reason,approvalMode:override?'development_test_override':'independent',...(override?{overrideRules:rules,readinessWarnings:readinessWarnings.slice(0,150),openTransactionIds:openTransactionIds.slice(0,200),openTransactionCount:openTransactionIds.length}:{})};
 const writes=[{path:activeWorkGroupPath(ctx.orgId),fields,...(d.active?{updateTime:d.active.updateTime}:{exists:false})},{path:activeWorkGroupPath(ctx.orgId)+'/revisions/'+String(version+1),fields,exists:false}];
 if(override){const a=buildAudit({category:'security',action:'testmode.work_group_activation',priority:'high',actor:ctx.actor,orgId:ctx.orgId,meta:ctx.meta,target:{type:'work_group_revision',id:String(version+1),label:selected.map(g=>g.code).join(', ')},controls:rules,details:reason+'; readiness issues: '+readinessWarnings.length+'; open transactions: '+openTransactionIds.slice(0,12).join(', ')});const id=randomId(20);await commit([...writes,{path:'audit_events/'+id,fields:a.data,exists:false},{path:'organizations/'+ctx.orgId+'/audit_events/'+id,fields:a.data,exists:false}]);}else await commit(writes);
 await audit([{category:'maintenance',action:'mnt.work_group.published',actor:ctx.actor,meta:ctx.meta,target:{label:'Work group workflow revision '+(version+1)},orgId:ctx.orgId,details:reason+'; '+selected.map(g=>g.code).join(', ')}]);
 return {version:version+1,masterVersion,groupIds:ids,testOverride:override,readinessWarnings,openTransactionCount:openTransactionIds.length};
}
export const maintenanceWorkGroupRoutes={
 'POST /api/org/mnt/work-groups/publish': [orgRoute('org.mnt.workGroups.publish','ADM.workflows',async ctx=>withLock(ctx.orgId,'maintenance_work_groups',()=>withLock(ctx.orgId,'maintenance_operations',()=>publishWorkGroups(ctx))))],
 'POST /api/org/mnt/work-groups': [orgRoute('org.mnt.workGroups.list','ADM.workflows',async ctx=>{
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
  const suggestion=suggestedMaster(d.groups,d.positions);
  const live=d.active?.data as unknown as ActiveWorkGroups|undefined;
  const master={version:Number(d.master?.data.version)||0,roleAlignment:d.master?mapOfStrings(d.master.data.roleAlignment):suggestion.roleAlignment,tasks:d.master?mergedMasterTasks(d.master||undefined):suggestion.tasks,importSuggestion:!d.master&&d.groups.some(g=>Object.keys(memberMap(g.data.members)).some(t=>memberMap(g.data.members)[t].length)||Object.keys(mapOfStrings(g.data.tasks)).length)};
  const groups=d.groups.map(g=>{
   const members=memberMap(g.data.members),costCenterIds=strings(g.data.costCenterIds);
   const paths=costCenterIds.map(id=>workGroupAncestry(d.nodes,id)).filter(p=>p.length);
   const assessment=assessWorkGroup(members,master.tasks,paths,d.users,today);
   const issues=[...assessment.issues,...workGroupConflicts(d.groups,g.id,costCenterIds,members)];
   if(!costCenterIds.length)issues.unshift('Assign at least one cost center.');
   if(!master.version)issues.unshift('Save the organization Work Groups master setup.');
   for(const t of WORK_GROUP_TITLES)for(const m of members[t]){
    if(!(master.roleAlignment[t]||[]).includes(m.positionCode))issues.push(t+': '+m.positionCode+' is not aligned in master setup.');
    const u=d.users.get(m.uid);
    if(!u||!paths.some(p=>workGroupHolder(u,m.positionCode,p,today)))issues.push('Employee '+m.uid+' no longer holds the assigned role within the group.');
   }
   return {id:g.id,code:str(g.data.code),name:str(g.data.name),siteId:str(g.data.siteId),version:Number(g.data.version)||0,costCenterIds,members,...assessment,issues,ready:issues.length===0,activeVersion:live?.groups.find(a=>a.id===g.id)?.version||0,updatedBy:str(g.data.updatedBy)};
  });
  return {maintenanceCycle:await getMaintenanceCycle(ctx),titles:WORK_GROUP_TITLES,tasks:WORK_GROUP_TASKS,sites,costCenters:cc.map(({path,...x})=>x),positions:[...d.positions.values()].map(p=>({id:p.id,label:nameOf(p)})),staff,groups,master:{...master,updatedBy:str(d.master?.data.updatedBy)},defaults:DEFAULT_WORK_GROUP_TASKS,linkedTasks:LINKED_WORK_GROUP_TASKS,active:{version:live?.version||0,masterVersion:live?.masterVersion||0,groupIds:live?.groups.map(g=>g.id)||[]},currentUserId:ctx.uid,testModeOverride:ctx.role==='org_super_admin'&&ctx.testMode===true,authorizationMode:live?.version?'work_groups':'legacy'};
 })],
 'POST /api/org/mnt/work-groups/cycle/save': [orgRoute('org.mnt.workGroups.cycle.save','ADM.workflows',async ctx=>withLock(ctx.orgId,'maintenance_work_groups',async()=>{
  assertAdmin(ctx);const path=cyclePath(ctx.orgId),old=await getDoc(path),prior=await getMaintenanceCycle(ctx),day=Number(ctx.body.startDay),timeZone=str(ctx.body.timeZone);
  if(ctx.body.startDay===undefined||!Number.isInteger(day)||day<0||day>6||!validZone(timeZone))throw new HttpError(400,'Choose a valid cycle start day and IANA timezone.');
  if(Number(ctx.body.expectedVersion)!==prior.version)throw new HttpError(409,'Cycle settings changed. Reload before saving.');
  const reason=str(ctx.body.reason).trim().slice(0,500);if(reason.length<5)throw new HttpError(400,'Enter the reason for changing the maintenance cycle.');
  const fields={startDay:day,timeZone,version:prior.version+1,reason,updatedAt:nowIso(),updatedBy:ctx.uid};
  await commit([{path,fields,...(old?{updateTime:old.updateTime}:{exists:false})},{path:path+'/revisions/'+String(fields.version),fields,exists:false}]);
  await audit([{category:'maintenance',action:'mnt.work_group.cycle_saved',actor:ctx.actor,meta:ctx.meta,target:{label:'Weekly maintenance cycle'},orgId:ctx.orgId,details:'Start day '+prior.startDay+' → '+day+'; '+prior.timeZone+' → '+timeZone+'; '+reason}]);
  return await getMaintenanceCycle(ctx);
 }))],
 'POST /api/org/mnt/work-groups/master/save': [orgRoute('org.mnt.workGroups.master.save','ADM.workflows',async ctx=>withLock(ctx.orgId,'maintenance_work_groups',async()=>{
  assertAdmin(ctx);const d=await setup(ctx),body=ctx.body;
  const version=Number(d.master?.data.version)||0;
  if(Number(body.expectedVersion)!==version)throw new HttpError(409,'Master setup has changed. Reload before saving.');
  if(!isObj(body.roleAlignment)||!isObj(body.tasks))throw new HttpError(400,'Role alignment and task assignments are required.');
  if(Object.keys(body.roleAlignment).some(k=>!title(k)))throw new HttpError(400,'Unknown generic maintenance title.');
  const roleAlignment:Record<string,string[]>={};
  for(const t of WORK_GROUP_TITLES){
   const ids=strings(body.roleAlignment[t]);if(ids.some(id=>!d.positions.has(id)))throw new HttpError(400,'Choose active organizational roles for '+t+'.');
   roleAlignment[t]=ids;
  }
  const tasks:Record<string,string[]>={};
  for(const [k,v] of Object.entries(body.tasks)){
   if(RETIRED_MAINTENANCE_KEYS.has(k))continue;
   const task=WORK_GROUP_TASKS.find(t=>t.code===k);if(!task)throw new HttpError(400,'Unknown maintenance task '+k+'.');
   const titles=strings(v);if(titles.some(x=>!title(x))||task.external&&titles.length)throw new HttpError(400,'Invalid generic role allocation or externally governed task.');
   if(!task.external)tasks[k]=titles;
  }
  // Editing either end of a one-to-one pair updates its linked end. Preserve an old mismatch until explicitly edited; never silently expand live authority.
  const priorTasks=d.master?mergedMasterTasks(d.master):{};
  const same=(a:string[],b:string[])=>a.length===b.length&&a.every(x=>b.includes(x));
  for(const [gate,permission] of LINKED_WORK_GROUP_TASKS){
   const hasGate=Object.prototype.hasOwnProperty.call(tasks,gate),hasPermission=Object.prototype.hasOwnProperty.call(tasks,permission);
   const gateChanged=hasGate&&!same(tasks[gate],priorTasks[gate]||[]),permissionChanged=hasPermission&&!same(tasks[permission],priorTasks[permission]||[]);
   if(hasGate&&!hasPermission||gateChanged&&!permissionChanged)tasks[permission]=[...tasks[gate]];
   else if(hasPermission&&!hasGate||permissionChanged&&!gateChanged)tasks[gate]=[...tasks[permission]];
  }
  // A published alignment cannot be removed from under an existing named member.
  const priorAlignment=mapOfStrings(d.master?.data.roleAlignment);
  if(d.master)for(const g of d.groups)for(const t of WORK_GROUP_TITLES)for(const m of memberMap(g.data.members)[t]){
   if((priorAlignment[t]||[]).includes(m.positionCode)&&!(roleAlignment[t]||[]).includes(m.positionCode))throw new HttpError(409,'Remove or transfer the named employee in '+str(g.data.code)+' before removing '+m.positionCode+' from '+t+'.');
  }
  const reason=str(body.reason).trim().slice(0,500)||'Partial draft saved';
  const fields={roleAlignment,tasks,defaultsVersion:1,version:version+1,updatedAt:nowIso(),updatedBy:ctx.uid,reason};
  await commit([{path:masterPath(ctx.orgId),fields,...(d.master?{updateTime:d.master.updateTime}:{exists:false})},{path:'organizations/'+ctx.orgId+'/maintenance_work_group_settings/default/revisions/'+String(version+1),fields,exists:false}]);
  await audit([{category:'maintenance',action:'mnt.work_group.master_saved',actor:ctx.actor,meta:ctx.meta,target:{label:'Work Groups master setup'},orgId:ctx.orgId,details:reason+'; revision '+(version+1)}]);
  return {version:version+1,tasks,authorizationMode:'legacy'};
 }))],
 'POST /api/org/mnt/work-groups/create': [orgRoute('org.mnt.workGroups.create','ADM.workflows',async ctx=>withLock(ctx.orgId,'maintenance_work_groups',async()=>{
  assertAdmin(ctx);const d=await setup(ctx),body=ctx.body;
  const name=str(body.name).trim().slice(0,120),siteId=str(body.siteId);
  if(name.length<3)throw new HttpError(400,'Enter a work group name (at least 3 characters).');
  if(str(d.nodes.get(siteId)?.data.level)!=='site'||!workGroupAncestry(d.nodes,siteId).length)throw new HttpError(400,'Choose an active site.');
  if(d.groups.some(g=>str(g.data.siteId)===siteId&&str(g.data.name).toLowerCase()===name.toLowerCase()))throw new HttpError(409,'A work group with this name already exists at this site.');
  const counter=await getDoc(sequencePath(ctx.orgId)),number=nextWorkGroupNumber(counter?.data.lastNumber,d.groups);
  const code='WG_'+String(number).padStart(4,'0'),id=randomId(16),at=nowIso();
  const fields={code,name,siteId,costCenterIds:[],members:memberMap(null),version:1,status:'draft',createdAt:at,createdBy:ctx.uid,updatedAt:at,updatedBy:ctx.uid};
  await commit([{path:groupCol(ctx.orgId)+'/'+id,fields,exists:false},{path:sequencePath(ctx.orgId),fields:{lastNumber:number,updatedAt:at},...(counter?{updateTime:counter.updateTime}:{exists:false})}]);
  await audit([{category:'maintenance',action:'mnt.work_group.created',actor:ctx.actor,meta:ctx.meta,target:{label:code},orgId:ctx.orgId,details:name+'; site '+siteId}]);
  return {id,code,version:1};
 }))],
 'POST /api/org/mnt/work-groups/save': [orgRoute('org.mnt.workGroups.save','ADM.workflows',async ctx=>withLock(ctx.orgId,'maintenance_work_groups',async()=>{
  assertAdmin(ctx);const d=await setup(ctx),body=ctx.body;
  const id=str(body.id);
  if(!uidPattern.test(id))throw new HttpError(400,'Create new work groups in Master setup.');
  const prior=d.groups.find(g=>g.id===id);if(!prior)throw new HttpError(404,'Work group not found.');
  const version=Number(prior.data.version)||0,masterVersion=Number(d.master?.data.version)||0;
  if(Number(body.expectedVersion)!==version)throw new HttpError(409,'Work group has changed. Reload first.');
  if(Number(body.expectedMasterVersion)!==masterVersion)throw new HttpError(409,'Save or reload the current Work Groups master setup first.');
  const siteId=str(prior.data.siteId),code=str(prior.data.code),costCenterIds=strings(body.costCenterIds);
  if(body.tasks!==undefined||body.roleAlignment!==undefined)throw new HttpError(400,'Role alignment and task assignment are maintained only in Master setup.');
  if(str(d.nodes.get(siteId)?.data.level)!=='site'||!workGroupAncestry(d.nodes,siteId).length)throw new HttpError(400,'The work group site is inactive.');
  if(costCenterIds.length>150)throw new HttpError(400,'Maximum 150 cost centers per work group.');
  const paths=costCenterIds.map(cc=>{const p=workGroupAncestry(d.nodes,cc);if(str(d.nodes.get(cc)?.data.level)!=='cost_center'||!p.includes(siteId))throw new HttpError(400,'All cost centers must belong to the selected site.');return p;});
  const eligiblePaths=paths.length?paths:[...d.nodes.values()].filter(n=>str(n.data.level)==='cost_center').map(n=>workGroupAncestry(d.nodes,n.id)).filter(p=>p.includes(siteId));
  if(!isObj(body.members)||Object.keys(body.members).some(k=>!title(k)))throw new HttpError(400,'Valid named assignments are required.');
  const alignment=d.master?mapOfStrings(d.master.data.roleAlignment):suggestedMaster(d.groups,d.positions).roleAlignment,tasks=d.master?mergedMasterTasks(d.master||undefined):DEFAULT_WORK_GROUP_TASKS;
  const members:Record<string,Member[]>={},today=nowIso().slice(0,10);
  for(const t of WORK_GROUP_TITLES){
   const raw=objects(body.members[t]);if(raw.length>100)throw new HttpError(400,'Maximum 100 members per generic title.');
   const seen=new Set<string>();members[t]=[];
   for(const m of raw){
    const uid=str(m.uid),positionCode=str(m.positionCode),u=d.users.get(uid);
    if(!(alignment[t]||[]).includes(positionCode)||!d.positions.has(positionCode))throw new HttpError(400,'The organizational role must be aligned to '+t+' in Master setup.');
    if(!u||!eligiblePaths.some(p=>workGroupHolder(u,positionCode,p,today)))throw new HttpError(400,'A named employee must currently hold the selected organization role within the group scope.');
    const key=positionCode+'|'+uid;if(!seen.has(key)){seen.add(key);members[t].push({uid,positionCode});}
   }
  }
  const conflicts=workGroupConflicts(d.groups,id,costCenterIds,members);
  if(conflicts.length)throw new HttpError(409,conflicts[0]);
  const reason=str(body.reason).trim().slice(0,500)||'Partial group draft saved';
  const assessment=assessWorkGroup(members,tasks,paths,d.users,today);
  if(!costCenterIds.length){assessment.issues.unshift('Assign at least one cost center.');assessment.ready=false;}
  const {tasks:oldTasks,...oldFields}=prior.data;
  const fields={...oldFields,costCenterIds,members,version:version+1,masterVersion,status:'draft',reason,updatedAt:nowIso(),updatedBy:ctx.uid,...(oldTasks!==undefined?{legacyTasks:oldTasks}:{})};
  await commit([{path:groupCol(ctx.orgId)+'/'+id,fields,updateTime:prior.updateTime}]);
  await audit([{category:'maintenance',action:'mnt.work_group.staffing_saved',actor:ctx.actor,meta:ctx.meta,target:{label:code},orgId:ctx.orgId,details:reason+'; revision '+(version+1)+'; master revision '+masterVersion}]);
  return {id,code,version:version+1,...assessment,authorizationMode:'legacy'};
 }))],
};
