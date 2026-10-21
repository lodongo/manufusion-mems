/** Method-specific RCA steps, independent of the mandatory DMAIC lifecycle. */
export const RCA_METHOD_STEPS:Record<string,readonly string[]>={
 '5WHY':['WHY-1','WHY-2','WHY-3','WHY-4','WHY-5'],
 'FTA':['TOP-EVENT','CAUSAL-BRANCH','BASIC-EVENT'],
 'FMEA':['FAILURE-MODE','EFFECT','CAUSE','DETECTION-CONTROL'],
 'PARETO':['DATASET','RANKED-CAUSES','VITAL-FEW'],
 '8D':['TEAM','CONTAINMENT','ROOT-CAUSE','CORRECTIVE-VERIFICATION'],
 'A3':['BACKGROUND','CURRENT-STATE','TARGET','COUNTERMEASURES'],
 'CAUSAL':['EVENTS','CONDITIONS','ROOT-CAUSES'],
 'DMAIC':['BASELINE','HYPOTHESIS','STATISTICAL-TEST'],
 'KT':['IS-IS-NOT','DISTINCTIONS','CHANGES','POSSIBLE-CAUSES'],
 'BOWTIE':['TOP-EVENT','THREATS','PREVENTIVE-BARRIERS','CONSEQUENCES','RECOVERY-BARRIERS'],
 'CHANGE':['BASELINE','CHANGES','DIFFERENCES'],
 'EVENT':['EVENT-SEQUENCE','CAUSAL-FACTORS','BARRIERS'],
 'TRIPOD':['IMMEDIATE-CAUSES','PRECONDITIONS','LATENT-FAILURES'],
 'APOLLO':['EFFECT','CAUSAL-PATHS','EVIDENCE'],
 'BARRIER':['REQUIRED-BARRIERS','FAILED-BARRIERS','GAPS'],
 'C&E':['INPUT-FACTORS','OUTPUT-EFFECTS','RELATIONSHIPS']
};
export function analyzeSteps(method:string,framework:string,factors:readonly string[]):string[]{
 if(method==='ISH')return [...factors];
 return [...(RCA_METHOD_STEPS[method]??[])];
}
export function validMethodAnalysis(method:string,framework:string,factors:readonly string[],rows:readonly {key:string;text:string}[],complete:boolean):boolean{
 const required=analyzeSteps(method,framework,factors);
 if(!required.length)return false;
 const keys=rows.map(r=>r.key);
 if(new Set(keys).size!==keys.length||keys.some(k=>!required.includes(k)))return false;
 return !complete||required.every(k=>rows.some(r=>r.key===k&&r.text.trim().length>=10));
}
