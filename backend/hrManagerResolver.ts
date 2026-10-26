import {fieldEq,isObj,runQuery,str} from './core';
import type {OrgContext} from './guards';
import {hrSiteOf} from './hrHierarchy';

type Rec={id:string;data:Record<string,unknown>};
type Node=Record<string,unknown>;
export type ManagerResolution={uid:string;reason:'resolved'|'unassigned'|'ambiguous';roleCode:string;nodeId:string};

const active=(d:Record<string,unknown>)=>str(d.status)!=='disabled';
const primary=(d:Record<string,unknown>)=>Array.isArray(d.assignments)?d.assignments.filter(isObj).filter(a=>str(a.type)==='primary'&&!!str(a.nodeId)):[];
const scope=(id:string,node:Node,nodes:Map<string,Node>)=>{
 const level=str(node.level);
 return ['site','legal_entity','group'].includes(level)?id:hrSiteOf(id,nodes);
};
export function resolveHrManager(
 employeeUid:string,employee:Record<string,unknown>,nodes:Map<string,Node>,users:readonly Rec[],
):ManagerResolution{
 const people=users.filter(p=>active(p.data));
 const byUid=new Map(people.map(p=>[p.id,p]));
 let ambiguous:ManagerResolution|null=null;
 for(const assignment of primary(employee)){
  let id=str(assignment.nodeId);const visited=new Set<string>();
  while(id&&!visited.has(id)){
   visited.add(id);
   const node=nodes.get(id);
   if(!node||str(node.status)==='inactive')break;
   const roleCode=str(node.managerRoleCode),legacyUid=str(node.managerUid);
   const nodeScope=scope(id,node,nodes);
   if(roleCode&&nodeScope){
    const candidates=people.filter(u=>u.id!==employeeUid&&primary(u.data).some(a=>
      str(a.positionCode)===roleCode&&str(a.nodeId)===nodeScope
    ));
    if(candidates.length===1)return {uid:candidates[0].id,reason:'resolved',roleCode,nodeId:id};
    if(candidates.length>1){
      ambiguous={uid:'',reason:'ambiguous',roleCode,nodeId:id};
      break; // Do not elevate a choice to a higher-level manager.
    }
    // If the configured managerial role has no occupant, move up the structure
    // to the next independently configured manager, not to an unrelated role.
   }else if(legacyUid&&legacyUid!==employeeUid){
    const person=byUid.get(legacyUid);
    if(person&&primary(person.data).some(a=>
      str(a.nodeId)===id||(!!nodeScope&&hrSiteOf(str(a.nodeId),nodes)===hrSiteOf(id,nodes))
    ))return {uid:legacyUid,reason:'resolved',roleCode:'',nodeId:id};
   }
   id=str(node.parentId);
  }
  if(ambiguous)break;
 }
 return ambiguous||{uid:'',reason:'unassigned',roleCode:'',nodeId:''};
}
export async function resolveHrManagerFor(ctx:OrgContext,employee:Record<string,unknown>,nodes:Map<string,Node>,users?:readonly Rec[]){
 const members=users||await runQuery({from:[{collectionId:'users'}],where:fieldEq('orgId',ctx.orgId)});
 return resolveHrManager(str(employee.uid),employee,nodes,members);
}

/** Employee-profile reporting is defined by the job role's parentCode in HR05.
 * Do not use the hierarchy managerRoleCode as a proxy for a line manager: that
 * role may be responsible for approving an entire site but not for the employee.
 * This resolver does not alter the separate workflow-approval manager resolver.
 */
export type ReportingResolution={
 uid:string;
 reason:'resolved'|'unconfigured'|'vacant'|'ambiguous';
 roleCode:string;
 nodeId:string;
};
export function resolveRoleReportingManager(
 employeeUid:string,employee:Record<string,unknown>,
 nodes:Map<string,Node>,positions:Map<string,Node>,users:readonly Rec[],
):ReportingResolution{
 const assignments=primary(employee);
 const people=users.filter(u=>u.id!==employeeUid&&active(u.data));
 const solutions:Array<{uid:string;roleCode:string;nodeId:string;distance:number}>=[];
 const declared=new Set<string>();
 let missing:{roleCode:string;nodeId:string}|null=null;
 for(const assignment of assignments){
  const code=str(assignment.positionCode);
  const parentCode=str(positions.get(code)?.parentCode);
  if(!parentCode)continue;
  declared.add(parentCode);
  const ancestors=new Map<string,number>();
  const visited=new Set<string>();
  let nodeId=str(assignment.nodeId),depth=0;
  while(nodeId&&!visited.has(nodeId)){
   visited.add(nodeId);
   const node=nodes.get(nodeId);
   if(node&&str(node.status)==='inactive')break;
   ancestors.set(nodeId,depth++);
   if(!node)break;
   nodeId=str(node.parentId);
  }
  let matched=false;
  for(const person of people){
   for(const candidate of primary(person.data)){
    if(str(candidate.positionCode)!==parentCode)continue;
    const assignedNode=str(candidate.nodeId),distance=ancestors.get(assignedNode);
    if(distance===undefined)continue;
    matched=true;
    solutions.push({uid:person.id,roleCode:parentCode,nodeId:assignedNode,distance});
   }
  }
  if(!matched)missing={roleCode:parentCode,nodeId:str(assignment.nodeId)};
 }
 if(!declared.size)return {uid:'',reason:'unconfigured',roleCode:'',nodeId:''};
 if(declared.size>1)return {uid:'',reason:'ambiguous',roleCode:'',nodeId:''};
 if(!solutions.length)return {uid:'',reason:'vacant',roleCode:[...declared][0],nodeId:missing?.nodeId||''};
 const closest=Math.min(...solutions.map(c=>c.distance));
 const nearest=[...new Map(solutions.filter(c=>c.distance===closest).map(c=>[c.uid,c])).values()];
 if(nearest.length!==1)return {uid:'',reason:'ambiguous',roleCode:[...declared][0],nodeId:''};
 const holder=nearest[0];
 return {uid:holder.uid,reason:'resolved',roleCode:holder.roleCode,nodeId:holder.nodeId};
}
