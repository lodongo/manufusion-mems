import {getDoc,listDocs,isObj,str,nowIso,type Doc} from './core';
import {MNT_ACTIVITIES} from './maintenanceActivities';
import {MAINTENANCE_GATES} from './maintenanceWorkflowConfig';

export const WORK_GROUP_TITLES=['Maintenance Lead','Maintenance Planner','Maintenance Clerk','Maintenance Specialist','Maintenance Technician','Operator'] as const;
const [L,P,C,S,T,O]=WORK_GROUP_TITLES;
export const externalGates=new Set(['MNT.MAT.CREATE','MNT.SPARES.RESERVE','MNT.SHORTAGE.SOURCE','MNT.WO.COST','MNT.SAFETY.SIGNOFF','MNT.HANDOVER']);
export const externalPermissions=new Set(['MNT.admin','MNT.WO.costApprove','MNT.WO.safety','MNT.WO.verify','MNT.view','MNT.activities.view']);
const sharedRequestRights=new Set(['MNT.WR.create','MNT.WR.edit','MNT.WR.cancel']);
export const managedPermissions=new Set(MNT_ACTIVITIES.map(a=>a.key).filter(k=>!externalPermissions.has(k)&&!sharedRequestRights.has(k)));
const managedGates=new Set(MAINTENANCE_GATES.filter(g=>g.status==='existing'&&!externalGates.has(g.code)&&g.mode!=='automated').map(g=>g.code));
export const DEFAULT_WORK_GROUP_TASKS:Record<string,string[]>={
 'MNT.WR.CREATE':[L,P,C,S,T,O],'MNT.WR.create':[L,P,C,S,T,O],'MNT.WR.edit':[L,P,C,S,T,O],'MNT.WR.cancel':[L,P,C,S,T,O],
 'MNT.WR.REVIEW':[L,S,T],'MNT.WR.review':[L,S,T],'MNT.WR.CLOSE':[L,S,T],'MNT.WR.close':[L,S,T],
 'MNT.WR.return':[L,S,T],'MNT.WR.decline':[L,S,T],'MNT.WR.closeConfirm':[L],
 'MNT.WR.ASSESS':[S,T],'MNT.assessment.edit':[S,T],'MNT.ASSESS.REVIEW':[L],'MNT.assessment.review':[L],
 'MNT.TASK.VALIDATE':[L],'MNT.activities.edit':[L,S,T],
 'MNT.WR.CONVERT':[P],'MNT.WR.convert':[P],
 'MNT.WO.PLAN':[P,C],'MNT.WO.plan':[P,C],
 'MNT.WO.RELEASE':[P],'MNT.WO.release':[P],
 'MNT.WINDOW.LOCK':[P],'MNT.WO.schedule':[P],
 'MNT.TASK.FEEDBACK':[S,T,O],'MNT.WO.execute':[S,T,O],
 'MNT.SPARES.RECONCILE':[P,C,S,T],
 'MNT.WO.close':[L],'MNT.WO.cancel':[L],'MNT.WO.reopen':[L],'MNT.budget.manage':[L,P]
};
type Member={uid:string;positionCode:string};
export type ActiveGroup={id:string;code:string;name:string;siteId:string;version:number;costCenterIds:string[];members:Record<string,Member[]>};
export type ActiveWorkGroups={version:number;masterVersion:number;roleAlignment:Record<string,string[]>;tasks:Record<string,string[]>;groups:ActiveGroup[]};
export type WorkGroupPolicy={config:ActiveWorkGroups;activePositions:Set<string>;paths:Map<string,string[]>;user:Doc;today:string};
export const activeWorkGroupPath=(orgId:string)=>'organizations/'+orgId+'/maintenance_work_group_active/default';
const arr=(v:unknown):string[]=>Array.isArray(v)?v.map(str).filter(Boolean):[];
const rows=(v:unknown):Record<string,unknown>[]=>Array.isArray(v)?v.filter(isObj):[];
export function assignmentCovers(user:Doc,role:string,path:string[],today:string):boolean {
 if(['disabled','inactive','suspended','deleted'].includes(str(user.data.status)))return false;
 return rows(user.data.assignments).slice(0,2).some((a,i)=>{
  const kind=i===0?'primary':str(a.type);
  return (kind==='primary'||(['acting','secondment','extended_function'].includes(kind)&&!!str(a.endsOn)))&&str(a.positionCode)===role&&path.includes(str(a.nodeId))&&(!str(a.startsOn)||str(a.startsOn)<=today)&&(!str(a.endsOn)||str(a.endsOn)>=today);
 });
}
export function ancestry(nodes:ReadonlyMap<string,Doc>,id:string):string[]{
 const path:string[]=[];const seen=new Set<string>();
 while(id&&id!=='root'&&!seen.has(id)&&path.length<20){
  const n=nodes.get(id);if(!n||str(n.data.status)==='inactive')return [];
  seen.add(id);path.unshift(id);id=str(n.data.parentId);
 }
 return id&&id!=='root'?[]:path;
}
export async function loadWorkGroupPolicy(orgId:string,user:Doc):Promise<WorkGroupPolicy|undefined>{
 const doc=await getDoc(activeWorkGroupPath(orgId));if(!doc||!Number(doc.data.version))return undefined;
 const config=doc.data as unknown as ActiveWorkGroups;
 if(!Array.isArray(config.groups)||!config.tasks||!config.roleAlignment)throw Error('Invalid active maintenance work group policy');
 const [positions,nodes]=await Promise.all([listDocs('organizations/'+orgId+'/positions'),listDocs('organizations/'+orgId+'/structure')]);
 const byNode=new Map(nodes.map(n=>[n.id,n]));
 const paths=new Map<string,string[]>();
 for(const group of config.groups)for(const cc of group.costCenterIds){
  const path=ancestry(byNode,cc);
  if(path.includes(group.siteId)&&str(byNode.get(cc)?.data.level)==='cost_center')paths.set(cc,path);
 }
 return {config,activePositions:new Set(positions.filter(p=>p.data.status!=='inactive').map(p=>p.id)),paths,user,today:nowIso().slice(0,10)};
}
export function groupAt(policy:WorkGroupPolicy|undefined,path:string[]):ActiveGroup|undefined{
 return policy?.config.groups.find(g=>g.costCenterIds.some(id=>path.includes(id)));
}
export function memberTitles(policy:WorkGroupPolicy,group:ActiveGroup):string[]{
 if(policy.config.groups.filter(g=>Object.values(g.members).some(ms=>ms.some(m=>m.uid===policy.user.id))).length!==1)return [];
 const paths=group.costCenterIds.map(id=>policy.paths.get(id)).filter((p):p is string[]=>!!p);
 return WORK_GROUP_TITLES.filter(t=>(group.members[t]||[]).some(m=>m.uid===policy.user.id&&policy.activePositions.has(m.positionCode)&&(policy.config.roleAlignment[t]||[]).includes(m.positionCode)&&paths.some(path=>assignmentCovers(policy.user,m.positionCode,path,policy.today))));
}
function mapped(policy:WorkGroupPolicy,group:ActiveGroup,code:string){
 const roles=memberTitles(policy,group);
 return roles.some(t=>(policy.config.tasks[code]||[]).includes(t));
}
const validLocation=(p:WorkGroupPolicy,g:ActiveGroup,path:string[])=>g.costCenterIds.some(id=>path.includes(id)&&p.paths.has(id));
/** null preserves independent authority and legacy locations. Managed actions can never fall back to legacy wildcard grants. */
export function workGroupPermission(policy:WorkGroupPolicy|undefined,permission:string,path:string[]):boolean|null{
 const group=groupAt(policy,path);if(!group||!policy)return null;
 const valid=validLocation(policy,group,path);
 if(permission==='MNT.view'||permission==='MNT.activities.view')return valid&&memberTitles(policy,group).length>0?true:null;
 if(sharedRequestRights.has(permission))return valid&&mapped(policy,group,permission)?true:null;
 if(!managedPermissions.has(permission))return null;
 return valid&&mapped(policy,group,permission);
}
export function groupGateRole(policy:WorkGroupPolicy|undefined,gate:string,path:string[],allowUnallocated=false):string|null{
 const g=groupAt(policy,path);
 if(!policy||!g||!managedGates.has(gate))return null;
 if(!validLocation(policy,g,path)||(!allowUnallocated&&!(policy.config.tasks[gate]||[]).length))return '';
 return 'WG:'+g.id+':'+policy.config.masterVersion+':'+g.version+':'+gate;
}
export function workGroupGateAllowed(policy:WorkGroupPolicy|undefined,gate:string,path:string[]):boolean|null{
 const token=groupGateRole(policy,gate,path);
 if(token===null)return null;
 const g=groupAt(policy,path)!;
 return !!token&&mapped(policy!,g,gate);
}
export function workGroupMenuPermissions(policy:WorkGroupPolicy|undefined):string[]{
 if(!policy)return [];
 const grants=new Set<string>();
 for(const g of policy.config.groups){
  if(!memberTitles(policy,g).length)continue;
  grants.add('MNT.view');grants.add('MNT.activities.view');
  for(const a of MNT_ACTIVITIES)if((managedPermissions.has(a.key)||sharedRequestRights.has(a.key))&&mapped(policy,g,a.key))grants.add(a.key);
 }
 // Temporary outside-group execution is only granted per explicitly allocated task, not via canAt.
 if(outsideExecutionRole(policy)){grants.add('MNT.view');grants.add('MNT.WO.execute');}
 return [...grants];
}
export function outsideExecutionRole(policy:WorkGroupPolicy|undefined):boolean{
 if(!policy||policy.user.data.status==='disabled')return false;
 const titles=(policy.config.tasks['MNT.TASK.FEEDBACK']||[]).filter(t=>(policy.config.tasks['MNT.WO.execute']||[]).includes(t));
 const positionCodes=new Set(titles.flatMap(t=>policy.config.roleAlignment[t]||[]));
 return rows(policy.user.data.assignments).slice(0,2).some(a=>{const role=str(a.positionCode),node=str(a.nodeId);return !!node&&positionCodes.has(role)&&policy.activePositions.has(role)&&assignmentCovers(policy.user,role,[node],policy.today);});
}
export function outsideExecutionAccess(policy:WorkGroupPolicy|undefined,record:Doc,taskId?:string):boolean{
 if(!policy||!groupAt(policy,arr(record.data.path))||!outsideExecutionRole(policy)||['closed','cancelled'].includes(str(record.data.status)))return false;
 const planning=isObj(record.data.taskPlanning)?record.data.taskPlanning:{};
 return Object.entries(planning).some(([id,p])=>{if(taskId&&id!==taskId)return false;const allocation=isObj(p)&&isObj(p.allocation)?p.allocation:{};return allocation.outsideGroupOptIn===true&&arr(allocation.outsideGroupPersonnel).includes(policy.user.id)&&arr(allocation.personnel).includes(policy.user.id);});
}
