/** Read-only, aggregated HR role staffing: never exposes employee identities. */
export type WorkforceAssignment={positionCode?:unknown;nodeId?:unknown;type?:unknown;startsOn?:unknown;endsOn?:unknown};
export type WorkforceRecord={id:string;data:Record<string,unknown>};
export type StaffingUnitOutlook={
 nodeId:string;name:string;approved:number;filled:number;vacant:number;surplus:number;temporary:number;
};
export type RoleStaffingOutlook={
 asOf:string;mappedEmployees:number;temporaryAssignments:number;approved:number|null;
 filledInPlan:number;vacant:number|null;surplus:number|null;unplanned:number;
 enabledUnits:number;units:StaffingUnitOutlook[];
};
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const string=(x:unknown)=>typeof x==='string'?x.trim():'';
const active=(person:WorkforceRecord)=>!['disabled','inactive'].includes(string(person.data.status).toLowerCase());
export function computeRoleStaffing(
 roleCode:string, rawPlan:unknown, people:WorkforceRecord[],
 unitNames:Map<string,string>, asOf:string
):RoleStaffingOutlook{
 const configured=new Map<string,StaffingUnitOutlook>();
 for(const raw of Array.isArray(rawPlan)?rawPlan:[]){
  if(!obj(raw)||raw.enabled!==true)continue;
  const nodeId=string(raw.nodeId),required=Number(raw.required);
  if(!nodeId||configured.has(nodeId)||!Number.isSafeInteger(required)||required<0)continue;
  configured.set(nodeId,{nodeId,name:unitNames.get(nodeId)||nodeId,
   approved:required,filled:0,vacant:0,surplus:0,temporary:0});
 }
 let mappedEmployees=0,temporaryAssignments=0,unplanned=0;
 for(const person of people){
  if(!active(person))continue;
  const assignments=Array.isArray(person.data.assignments)?person.data.assignments.filter(obj):[];
  // Each employee may occupy at most one primary position for a given role.
  const primary=assignments.find((a,i)=>
   string(a.positionCode)===roleCode&&(string(a.type)==='primary'||(i===0&&!string(a.type))));
  if(primary){
   mappedEmployees++;
   const unit=configured.get(string(primary.nodeId));
   if(unit)unit.filled++;
   else unplanned++;
  }
  // Temporary cover does not fill approved permanent headcount.
  const temporaryNodes=new Set<string>();
  for(const a of assignments){
   if(string(a.positionCode)!==roleCode)continue;
   if(!['acting','secondment','extended_function'].includes(string(a.type)))continue;
   const startsOn=string(a.startsOn),endsOn=string(a.endsOn);
   if(!startsOn||!endsOn||startsOn>asOf||endsOn<asOf)continue;
   const nodeId=string(a.nodeId);
   if(temporaryNodes.has(nodeId))continue;
   temporaryNodes.add(nodeId);temporaryAssignments++;
   const unit=configured.get(nodeId);
   if(unit)unit.temporary++;
  }
 }
 const units=[...configured.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.nodeId.localeCompare(b.nodeId));
 for(const unit of units){
  unit.vacant=Math.max(0,unit.approved-unit.filled);
  unit.surplus=Math.max(0,unit.filled-unit.approved);
 }
 const enabledUnits=units.length;
 return {
  asOf,mappedEmployees,temporaryAssignments,
  approved:enabledUnits?units.reduce((n,u)=>n+u.approved,0):null,
  filledInPlan:units.reduce((n,u)=>n+u.filled,0),
  vacant:enabledUnits?units.reduce((n,u)=>n+u.vacant,0):null,
  surplus:enabledUnits?units.reduce((n,u)=>n+u.surplus,0):null,
  unplanned,enabledUnits,units,
 };
}
