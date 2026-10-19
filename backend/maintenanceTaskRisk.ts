/** Shared SAF risk matrix evaluation used for task-level work assessment. */
export interface RiskMatrixFactor{code:string;label:string;max:number;enabled:boolean}
export interface RiskMatrixBand{label:string;min:number;max:number;color:string;action:string}
export interface RiskMatrix{version:number;formula:'multiply'|'add';factors:RiskMatrixFactor[];bands:RiskMatrixBand[];tolerableMax:number;severityOverride:number}
export const defaultMaintenanceRiskMatrix:RiskMatrix={
 version:1,formula:'multiply',factors:[
  {code:'P',label:'Probability',max:5,enabled:true},
  {code:'S',label:'Severity',max:5,enabled:true},
  {code:'E',label:'Exposure',max:5,enabled:true},
  {code:'A',label:'People affected',max:2,enabled:true}
 ],bands:[
  {label:'Low',min:1,max:20,color:'#16a34a',action:'Routine controls'},
  {label:'Moderate',min:21,max:50,color:'#eab308',action:'Managed improvement'},
  {label:'High',min:51,max:100,color:'#f97316',action:'Priority corrective action'},
  {label:'Critical',min:101,max:250,color:'#dc2626',action:'Stop work and escalate'},
 ],tolerableMax:50,severityOverride:5
};
export function scoreMaintenanceRisk(matrix:RiskMatrix,ratings:Record<string,number>){
 const active=matrix.factors.filter(f=>f.enabled);
 if(!active.length)throw Error('Configure at least one SAF risk factor.');
 const normalized:Record<string,number>={};
 for(const factor of matrix.factors){
   const n=Number(ratings[factor.code]);
   if(factor.enabled&&(!Number.isInteger(n)||n<1||n>factor.max))
     throw Error('Select a valid '+factor.label+' score between 1 and '+factor.max+'.');
   if(Number.isInteger(n)&&n>=1&&n<=factor.max)normalized[factor.code]=n;
 }
 const total=active.reduce((n,f)=>matrix.formula==='add'?n+normalized[f.code]:n*normalized[f.code],matrix.formula==='add'?0:1);
 const band=matrix.bands.find(b=>total>=b.min&&total<=b.max);
 if(!band)throw Error('The SAF risk matrix does not cover this score.');
 return {ratings:normalized,score:total,band:band.label,color:band.color,tolerability:total>matrix.tolerableMax?'Intolerable':'Tolerable',matrixVersion:matrix.version};
}
export function finalizeAssessedTaskRisks<T extends {risk:Array<{before:string;after:string;beforeRatings?:Record<string,number>;afterRatings?:Record<string,number>}>}>(tasks:T[],matrix:RiskMatrix):T[]{
 return tasks.map(task=>({...task,risk:task.risk.map(r=>{
   if(!r.beforeRatings||!r.afterRatings)throw Error('Select initial and residual risk factor ratings for every task hazard.');
   const before=scoreMaintenanceRisk(matrix,r.beforeRatings);
   const after=scoreMaintenanceRisk(matrix,r.afterRatings);
   if(after.tolerability==='Intolerable')throw Error('Residual risk is intolerable. Add further mitigation before completing the assessment.');
   return {...r,before:`${before.score} · ${before.band}`,after:`${after.score} · ${after.band}`,
      beforeScore:before,afterScore:after};
 })})) as T[];
}
