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
