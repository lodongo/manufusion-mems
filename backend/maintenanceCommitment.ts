// Assessment estimate, not a capacity-checked or safety-authorized work schedule.
import type {AssessedTask} from './maintenanceTaskAssessment';
type EstimateTask=Pick<AssessedTask,'hours'|'persons'|'rate'|'subtaskDurations'|'subtaskRoles'|'internalRoleRequirements'|'spares'|'services'>;
const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;
const round=(v:number)=>Math.round(v*1000)/1000;
export function commitmentMetrics(tasks:EstimateTask[],currency:string){
 let internalHours=0,internalManHours=0,externalHours=0,externalManHours=0,unknownServiceTime=0,unpriced=0,unrated=0;
 const blocks:number[]=[],costs:Record<string,{spares:number;services:number;labour:number}>={};
 const add=(c:string,k:'spares'|'services'|'labour',v:number)=>{if(!/^[A-Za-z]{3}$/.test(c))return;const row=costs[c]||(costs[c]={spares:0,services:0,labour:0});row[k]+=v;};
 for(const t of tasks){
  const h=t.subtaskDurations?.length?t.subtaskDurations.reduce((s,v)=>s+n(v),0):n(t.hours);internalHours+=h;if(h)blocks.push(h);
  const roles=t.subtaskRoles?.flat()??t.internalRoleRequirements,man=roles?roles.reduce((s,r)=>s+n(r.persons)*n(r.hours),0):h*n(t.persons);internalManHours+=man;
  if(man>0){if(n(t.rate)>0&&currency)add(currency,'labour',man*t.rate);else unrated++;}
  for(const s of t.spares){if(s.estimateUomMatches&&s.estimateCurrency&&typeof s.estimateUnitPrice==='number'&&Number.isFinite(s.estimateUnitPrice)&&s.estimateUnitPrice>=0)add(s.estimateCurrency,'spares',s.estimateUnitPrice*n(s.qty));else unpriced++;}
  for(const s of t.services){const h=n(s.durationHours);if(h){externalHours+=h;blocks.push(h);externalManHours+=h*n(s.personnel);}else unknownServiceTime++;if(typeof s.expectedCost==='number'&&Number.isFinite(s.expectedCost)&&s.expectedCost>=0&&currency)add(currency,'services',s.expectedCost);else unpriced++;}
 }
 const sequentialHours=round(internalHours+externalHours),maxOverlapHours=round(Math.max(0,sequentialHours-Math.max(0,...blocks)));
 const knownCosts=Object.keys(costs).sort().map(currency=>({currency,...Object.fromEntries(Object.entries(costs[currency]).map(([k,v])=>[k,Math.round(v*100)/100])) as {spares:number;services:number;labour:number}}));
 return {internalHours:round(internalHours),internalManHours:round(internalManHours),externalHours:round(externalHours),externalManHours:round(externalManHours),totalManHours:round(internalManHours+externalManHours),sequentialHours,maxOverlapHours,unknownServiceTime,unpriced,unrated,knownCosts};
}
export function commitmentElapsed(metrics:ReturnType<typeof commitmentMetrics>,overlap:number,hoursPerDay:number){
 if(!Number.isFinite(overlap)||overlap<0||overlap>metrics.maxOverlapHours||!Number.isFinite(hoursPerDay)||hoursPerDay<=0||hoursPerDay>24)throw Error('Enter feasible concurrent hours and available hours per day (above 0 and at most 24).');
 const elapsedHours=round(metrics.sequentialHours-overlap),days=Math.max(1,Math.ceil(elapsedHours/hoursPerDay));
 return {elapsedHours,days};
}
export function proposedEnd(start:string,days:number){const d=new Date(start+'T00:00:00Z');if(!Number.isFinite(d.getTime())||!Number.isInteger(days)||days<1||days>367)return '';d.setUTCDate(d.getUTCDate()+days-1);return d.toISOString().slice(0,10);}
