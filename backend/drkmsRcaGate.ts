/** Fail-closed completion gate for controlled RCA knowledge publication. */
export const RCA_PHASES=['DEFINE','MEASURE','ANALYZE','IMPROVE','CONTROL'] as const;
const mandatory:Record<string,string[]>={DEFINE:['problem','impact','scope'],MEASURE:['baseline','evidence'],
 ANALYZE:['causalAnalysis','validatedCauses'],IMPROVE:['correctiveActions','actionOwners'],
 CONTROL:['effectivenessCriteria','monitoringPlan']};
export function rcaDmaicComplete(document:Record<string,unknown>):boolean{
 if(document.subtypeCode!=='RCA')return true;
 if(typeof document.rcaMethodCode!=='string'||!document.rcaMethodCode.trim())return false;
 const state=document.rcaDmaic;
 if(!state||typeof state!=='object'||Array.isArray(state))return false;
 const data=state as Record<string,unknown>;
 const completed=Array.isArray(data.completedPhases)?data.completedPhases:[];
 if(!RCA_PHASES.every(p=>completed.includes(p)))return false;
 const phases=data.phases;
 if(!phases||typeof phases!=='object'||Array.isArray(phases))return false;
 for(const phase of RCA_PHASES){
   const item=(phases as Record<string,unknown>)[phase];
   if(!item||typeof item!=='object'||Array.isArray(item))return false;
   const fields=item as Record<string,unknown>;
   if(mandatory[phase].some(k=>typeof fields[k]!=='string'||String(fields[k]).trim().length<12))return false;
   if(phase==='ANALYZE'&&(!Array.isArray(fields.methodAnalysis)
     ||fields.methodAnalysis.filter((r:unknown)=>r&&typeof r==='object'&&!Array.isArray(r)
       &&typeof (r as Record<string,unknown>).text==='string'
       &&String((r as Record<string,unknown>).text).trim().length>=10).length<2))return false;
 }
 return true;
}
