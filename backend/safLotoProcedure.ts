// Ordered energy-point instructions, not proof of isolation or execution authorization.
export const LOTO_MAX_STEPS=20,LOTO_STEP_LIMIT=300,LOTO_VERIFICATION_LIMIT=500,LOTO_TOTAL_STEP_LIMIT=3000;
export const NO_CREDIBLE_ENERGY='No credible hazardous energy — documented assessment';
export type LotoProcedure={procedureSteps:string[];verification:string};
export function readLotoProcedure(row:{procedureSteps?:unknown;verification?:unknown}):LotoProcedure{
 return {procedureSteps:Array.isArray(row.procedureSteps)?row.procedureSteps.filter((x):x is string=>typeof x==='string'):[],verification:typeof row.verification==='string'?row.verification:''};
}
export function normalizeLotoProcedure(steps:unknown,verification:unknown):LotoProcedure{
 if(!Array.isArray(steps)||steps.length>LOTO_MAX_STEPS||steps.some(s=>typeof s!=='string'||s.length>LOTO_STEP_LIMIT)||typeof verification!=='string'||verification.length>LOTO_VERIFICATION_LIMIT)throw Error('Invalid LOTO instructions: maximum 20 steps, 300 characters per step and 500 for verification.');
 const procedureSteps=(steps as string[]).map(s=>s.trim());
 if(procedureSteps.join('').length>LOTO_TOTAL_STEP_LIMIT)throw Error('LOTO procedure exceeds 3000 characters. Shorten the instructions or reference the approved detailed procedure.');
 return {procedureSteps,verification:verification.replace(/\s+/g,' ').trim()};
}
export function lotoProcedureRequired(linked:boolean,values:Record<string,unknown>){return !(linked&&values.exposure===NO_CREDIBLE_ENERGY);}
export function lotoProcedureIssues(p:LotoProcedure,required:boolean):string[]{
 const any=p.procedureSteps.some(s=>s.trim())||!!p.verification.trim(),issues:string[]=[];
 if(!required&&!any)return issues;
 if(!p.procedureSteps.length||p.procedureSteps.some(s=>!s.trim()))issues.push('Complete numbered isolation procedure steps');
 if(!p.verification.trim())issues.push('Isolation verification statement');
 return issues;
}
export function lotoProcedureText(p:LotoProcedure):string{
 return 'Procedure:\n'+(p.procedureSteps.length?p.procedureSteps.map((s,i)=>(i+1)+'. '+(s.trim()||'Not recorded')).join('\n'):'Not recorded')+'\n\nVerification: '+(p.verification.trim()||'Not recorded');
}

export type LotoDiagnosticPoint={label:string;tag:string;status:string;required:boolean;issues?:string[];procedureSteps?:string[];verification?:string};
export function lotoProgramDiagnostics(mode:string,points:LotoDiagnosticPoint[]):string[]{
 const gaps:string[]=[];
 if(!['group_box','individual_points'].includes(mode))gaps.push('Select Group LOTO box or Individual isolation points in Safety LOTO Setup.');
 if(!points.length)gaps.push('No hazardous energy points are registered for this equipment.');
 if(points.length&&!points.some(p=>p.required))gaps.push('All registered points are classified as no credible hazardous energy. Full LOTO requires at least one actual hazardous energy point; review Energy / hazardous exposure classification or reclassify the task if Full LOTO is not applicable.');
 for(const p of points){
  const name=p.label+' — '+(p.tag||'untagged');
  const issues=p.issues||[];
  if(issues.length)for(const issue of issues)gaps.push(name+': '+issue);
  else if(p.status!=='documented')gaps.push(name+': '+(p.status==='draft'?'Saved as draft. Review current utility details and use Mark register documented.':'Register status '+p.status+'; resolve and document the point.'));
 }
 return gaps;
}
export function lotoExposureNotice(point:LotoDiagnosticPoint):string{
 return !point.required&&(point.procedureSteps?.some(s=>s.trim())||point.verification?.trim())?'This point is excluded from Full LOTO because its saved exposure classification is No credible hazardous energy, despite a recorded isolation procedure. If it supplies hazardous energy, change Energy / hazardous exposure classification to Hazardous energy present and complete any newly applicable fields. Do not change the classification merely to clear the warning.':'';
}
