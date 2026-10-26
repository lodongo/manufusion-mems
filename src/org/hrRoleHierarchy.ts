import type {RoleStaffingOutlook} from '../../backend/hrRoleStaffingOutlook';

export type HrRoleCardData={
 code:string;title:string;description:string;parentCode:string;operatingLevel:string;
 defaultNodeId:string;requiredSkillCount:number;gradeMappings:number;
 staffing:RoleStaffingOutlook|null;
};
const compareRoles=(a:HrRoleCardData,b:HrRoleCardData)=>
 a.title.localeCompare(b.title,undefined,{sensitivity:'base'})||a.code.localeCompare(b.code);
export function roleHierarchy(roles:HrRoleCardData[]){
 const byCode=new Map(roles.map(role=>[role.code,role]));
 const children=new Map<string,HrRoleCardData[]>();
 for(const role of roles){
  const list=children.get(role.parentCode)||[];
  list.push(role);children.set(role.parentCode,list);
 }
 for(const list of children.values())list.sort(compareRoles);
 const sorted=roles.slice().sort(compareRoles);
 const roots=sorted.filter(role=>!role.parentCode||role.parentCode===role.code||!byCode.has(role.parentCode));
 const seen=new Set<string>();
 const visit=(code:string)=>{
  if(seen.has(code))return;
  seen.add(code);
  for(const child of children.get(code)||[])visit(child.code);
 };
 roots.forEach(role=>visit(role.code));
 // Orphaned/cyclic catalogue references never make a role disappear.
 for(const role of sorted)if(!seen.has(role.code)){roots.push(role);visit(role.code);}
 return {byCode,children,roots};
}
export type RoleHierarchy=ReturnType<typeof roleHierarchy>;
export function roleTrail(code:string,index:RoleHierarchy):string[]{
 const result:string[]=[];const seen=new Set<string>();
 let current=code;
 while(current&&index.byCode.has(current)&&!seen.has(current)){
  result.unshift(current);seen.add(current);
  current=index.byCode.get(current)?.parentCode||'';
 }
 return result;
}
export function vacancyOutlook(role:HrRoleCardData):{label:string;tone:'neutral'|'good'|'warn'|'alert'}{
 const s=role.staffing;
 if(!s)return {label:'Staffing restricted',tone:'neutral'};
 if(s.approved===null)return {label:'Plan not configured',tone:'neutral'};
 if((s.vacant||0)>0&& (s.surplus||0)>0)return {label:`${s.vacant} vacant · ${s.surplus} surplus`,tone:'warn'};
 if((s.vacant||0)>0)return {label:`${s.vacant} vacancies`,tone:'alert'};
 if((s.surplus||0)>0)return {label:`${s.surplus} surplus`,tone:'warn'};
 return {label:'Fully staffed',tone:'good'};
}
