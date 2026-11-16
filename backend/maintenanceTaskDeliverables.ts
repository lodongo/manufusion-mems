import {str,isObj,type Obj} from './core';
export function requirementItems(raw:unknown,label:string):string[]{
 if(!Array.isArray(raw)||raw.length>50||raw.some(x=>typeof x!=='string'||!x.trim()||x.trim().length>500))throw Error(label+': enter up to 50 individual items, each 1–500 characters.');
 const seen=new Set<string>();return (raw as string[]).map(x=>x.trim()).filter(x=>{const k=x.toLowerCase().replace(/\s+/g,' ');if(seen.has(k))return false;seen.add(k);return true;});
}
export function taskRequirementDefaults(t:Obj){
 const scope=(str(t.name)+' '+str(t.familyCode)).toLowerCase(),steps=Array.isArray(t.subtasks)?t.subtasks.filter(isObj):[];
 const evidence=steps.map(s=>[str(s.name),str(s.checkpoint),JSON.stringify(s.evidenceRequired||[])].join(' ')).join(' ').toLowerCase();
 const outcomes=['Completed task: '+str(t.name).slice(0,220),'Recorded completion results and outstanding defects'];
 if(/inspect|condition|measurement|diagnos|check/.test(scope+' '+evidence))outcomes.push('Inspection findings and measurements against applicable acceptance criteria');
 if(/failure|failed|fault|corrective|repair|replace|overhaul/.test(scope))outcomes.push('As-found evidence and failure-mode / cause investigation record','Repaired or replaced components verified against approved specifications');
 if(/test|commission|functional|verif/.test(evidence)||/repair|replace|commission|overhaul/.test(scope))outcomes.push('Applicable test results against approved acceptance criteria');
 if(/calibrat/.test(scope))outcomes.push('Calibration results: as-found and as-left readings, reference and tolerances');
 if(/lubricat|greas|oil change/.test(scope))outcomes.push('Lubricant type, quantity and service point record');
 if(/clean|saniti/.test(scope))outcomes.push('Cleanliness / sanitation verified against applicable standard');
 const certs=['Evidence of minimum qualification and competency for the assigned trade or role'];
 if(/boiler|pressure vessel|steam generator/.test(scope))certs.push(/statutory|inspect|certif|examin|pressure test/.test(scope)?'Statutory inspection certificate or report from a legally authorized competent inspector, where required':'Applicable boiler or pressure-equipment authorization, where required by jurisdiction and scope');
 if(/weld|braz/.test(scope))certs.push('Applicable welder or joining-process qualification for the specified procedure, where required');
 if(/calibrat|metrolog/.test(scope))certs.push('Calibration competence and traceability; accredited scope where contractually or legally required');
 if(/electrical|wiring|switchgear|high.voltage|substation/.test(scope))certs.push('Applicable electrical trade licence or authorization, where legally required');
 if(/lift|crane|hoist|rigging/.test(scope)&&/inspect|test|certif/.test(scope))certs.push('Applicable lifting-equipment examiner competency or statutory inspection authorization, where required');
 if(/refriger|refrigerant/.test(scope))certs.push('Applicable refrigerant-handling qualification or authorization, where required');
 return {expectedOutcomes:requirementItems(t.expectedOutcomes===undefined?outcomes:t.expectedOutcomes,'Expected outcomes'),requiredCertifications:requirementItems(t.requiredCertifications===undefined?certs:t.requiredCertifications,'Required certifications')};
}
export function withTaskRequirements(t:Obj):Obj{return {...t,...taskRequirementDefaults(t)};}
