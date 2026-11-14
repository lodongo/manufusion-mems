// Classification recommendation only. A task master record never grants permission to execute.
export const TASK_QUESTIONS=[
 ['routine','Is this a normal, routine, repetitive task integral to production?'],
 ['stop','Does the equipment need to stop to perform the task?'],
 ['body','Does any body part enter the equipment or an associated danger zone?'],
 ['door','Does a guard or access door need to be opened, removed or bypassed?'],
 ['moving','Is interaction with moving parts, unexpected motion or stored energy possible?'],
 ['otherExposure','Is there any other credible hazardous exposure (including electrical, pressure, thermal, chemical or gravity)?'],
 ['inching','Is controlled inching, jogging or positioning necessary?'],
 ['minorProtected','Is this minor servicing with validated alternative safeguards that provide effective protection throughout?'],
 ['loss','Would full isolation cause substantial production or process-state loss?'],
 ['infeasible','Is full isolation technically infeasible for the necessary task, or would it introduce additional safety hazards?'],
 ['partial','Can unrelated hazardous energy be isolated while only technically necessary energy remains?'],
] as const;
export type Answers=Record<string,string>;
export function questionsFor(a:Answers){
 const core=TASK_QUESTIONS.slice(0,7);
 const exposed=['body','door','moving'].some(k=>a[k]==='yes');
 return [...core,...(a.routine==='yes'&&a.stop==='yes'&&exposed&&a.inching!=='yes'?[TASK_QUESTIONS[7]]:[]),...(exposed||a.otherExposure==='yes'||a.inching==='yes'?[TASK_QUESTIONS[8],TASK_QUESTIONS[9]]:[]),...(a.inching==='yes'||a.infeasible==='yes'?[TASK_QUESTIONS[10]]:[])];
}
export function decideTask(a:Answers){
 const required=questionsFor(a);
 if(required.some(([k])=>!['yes','no'].includes(a[k])))return {code:'',reason:'Complete all applicable screening questions.',exception:false};
 const exposed=['body','door','moving'].some(k=>a[k]==='yes'),hazard=exposed||a.otherExposure==='yes';
 if(a.inching==='yes')return {code:'AC22',reason:'Controlled motion is technically necessary; isolate unrelated energy and validate safeguards. Independent authorization required.',exception:true};
 if(!hazard)return {code:'AC01',reason:'No credible exposure identified in the defined scope. Document and verify screening; reassess if conditions change.',exception:false};
 if(a.routine==='yes'&&a.stop==='yes'&&exposed&&a.minorProtected==='yes'&&a.infeasible!=='yes')return {code:'AC02',reason:'Routine minor intervention with effective alternative protection proposed. Verify eligibility and safeguards before execution.',exception:true};
 if(a.infeasible==='yes')return a.partial==='yes'?{code:'AC06',reason:'Partial LOTO candidate: isolate all energy not technically required, assess retained energy separately.',exception:true}:{code:'AC05',reason:'Live work candidate: independently establish technical infeasibility or increased safety hazard and lawful authorization.',exception:true};
 return {code:'AC03',reason:a.loss==='yes'?'Production loss alone does not justify live work. Full LOTO remains the default.':'Hazardous energy exposure: full LOTO is the default.',exception:false};
}
export const TASK_ADDITIONAL_CLASSES=['AC04','AC07','AC08','AC09','AC10','AC11','AC12','AC13','AC14','AC15','AC16','AC17','AC18','AC19','AC20','AC21'];
export const EXECUTOR_TYPES=['Operator','Technical operator','Mechanical technician','Electrical / automation technician','Shift specialist','Engineer','Maintenance supervisor','Authorized specialist','External service provider','Multi-disciplinary team'];
export const TASK_PLAN_STATES=['isolate','retained','not_applicable'];
