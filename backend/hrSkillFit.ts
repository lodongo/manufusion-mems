/** Approved-skill coverage against the assigned role's required skill codes.
 * Pending/rejected nominations and colleague endorsements never increase fit.
 * No role requirements => null (not an invented 100% score).
 */
import { isObj, str } from './core';

export type HrSkillFit={
  percentage:number|null;confirmed:number;required:number;pending:number;
  confirmedCodes:string[];requiredCodes:string[];missingCodes:string[];pendingCodes:string[];
};
type Entry={id:string;data:Record<string,unknown>};
const unique=(values:string[])=>[...new Set(values.map(v=>v.trim()).filter(Boolean))];
export function requiredRoleSkills(user:Record<string,unknown>,positions:Map<string,Record<string,unknown>>){
  const assignments=Array.isArray(user.assignments)?user.assignments.filter(isObj):[];
  const codes=unique(assignments.filter(a=>str(a.type)==='primary')
    .map(a=>str(a.positionCode)).filter(Boolean));
  return unique(codes.flatMap(code=>{
    const skills=positions.get(code)?.coreSkills;
    return Array.isArray(skills)?skills.filter((x):x is string=>typeof x==='string'):[];
  }));
}
export function makeSkillFit(
 uid:string,user:Record<string,unknown>,positions:Map<string,Record<string,unknown>>,
 proposals:readonly Entry[],
):HrSkillFit{
 const requiredCodes=requiredRoleSkills(user,positions);
 const mine=proposals.filter(p=>str(p.data.employeeUid)===uid);
 const confirmedCodes=unique(mine.filter(p=>str(p.data.status)==='approved').map(p=>str(p.data.skillCode)));
 const pendingCodes=unique(mine.filter(p=>str(p.data.status)==='pending').map(p=>str(p.data.skillCode)));
 const approved=new Set(confirmedCodes);
 const missingCodes=requiredCodes.filter(code=>!approved.has(code));
 const confirmed=requiredCodes.length-missingCodes.length;
 const pending=missingCodes.filter(code=>pendingCodes.includes(code)).length;
 return {
   percentage:requiredCodes.length?Math.round(confirmed/requiredCodes.length*100):null,
   confirmed,required:requiredCodes.length,pending,
   confirmedCodes,requiredCodes,missingCodes,pendingCodes,
 };
}
export function buildFitIndex(users:readonly Entry[],positions:readonly Entry[],proposals:readonly Entry[]){
 const pos=new Map(positions.map(p=>[p.id,p.data]));
 const lookup=new Map<string,Entry[]>();
 for(const p of proposals){
  const uid=str(p.data.employeeUid);
  if(!lookup.has(uid))lookup.set(uid,[]);
  lookup.get(uid)!.push(p);
 }
 return new Map(users.map(u=>[u.id,makeSkillFit(u.id,u.data,pos,lookup.get(u.id)||[])]));
}
