// Classification recommendation only. A task master record never grants permission to execute.
export const TASK_QUESTIONS=[
 ['routine','Is this a normal, routine, repetitive task integral to production?'],
 ['stop','Does the equipment need to stop to perform the task?'],
 ['body','Does any body part enter the equipment or an associated danger zone?'],
 ['door','Does a guard or access door need to be opened, removed or bypassed?'],
 ['moving','Is interaction with moving parts, unexpected motion or stored energy possible?'],
 ['otherExposure','Is there any other credible hazardous-energy exposure (electrical, pressure, thermal, chemical or gravity)?'],
 ['nonEnergy','Are there any other credible hazards or permit-triggering conditions (height, confined spaces, lifting, traffic, etc.)?'],
 ['inching','Is controlled inching, jogging or positioning necessary?'],
 ['minorProtected','Is this minor servicing with validated alternative safeguards that provide effective protection throughout?'],
 ['loss','Would full isolation cause substantial production or process-state loss?'],
 ['infeasible','Is full isolation technically infeasible for the necessary task, or would it introduce additional safety hazards?'],
 ['partial','Can unrelated hazardous energy be isolated while only technically necessary energy remains?'],
] as const;
export type Answers=Record<string,string>;
export type Question=typeof TASK_QUESTIONS[number];
type Decision={code:string;reason:string;exception:boolean};
const pending:Decision={code:'',reason:'Complete the next screening question.',exception:false};
// Walk only the reachable branch; unanswered questions halt evaluation. Extra/stale answers are ignored.
export function taskDecisionPath(a:Answers):{path:Question[];answers:Answers;next:Question|null;decision:Decision}{
 const path:Question[]=[],answers:Answers={};
 let next:Question|null=null;
 const ask=(key:Question[0])=>{
  const q=TASK_QUESTIONS.find(x=>x[0]===key)!;path.push(q);
  const v=a[key];if(v!=='yes'&&v!=='no'){next=q;return null;}
  answers[key]=v;return v;
 };
 const result=(decision:Decision=pending)=>({path,answers,next,decision});
 const routine=ask('routine');if(!routine)return result();
 const stop=routine==='yes'?ask('stop'):'no';if(!stop)return result();
 const body=ask('body');if(!body)return result();
 const door=ask('door');if(!door)return result();
 const moving=ask('moving');if(!moving)return result();
 const other=ask('otherExposure');if(!other)return result();
 const inch=ask('inching');if(!inch)return result();
 if(inch==='yes')return result({code:'AC22',reason:'Controlled motion is technically necessary; identify and isolate unrelated energy and validate safeguards. Independent authorization required.',exception:true});
 const exposed=[body,door,moving,other].includes('yes');
 if(!exposed){
  const nonEnergy=ask('nonEnergy');if(!nonEnergy)return result();
  return result(nonEnergy==='yes'?{code:'AC20',reason:'Other hazards or permit-triggering conditions are present. Assess all applicable additional classes.',exception:false}:{code:'AC01',reason:'No credible exposure identified in the defined scope. Verify screening and reassess if conditions change.',exception:false});
 }
 if(routine==='yes'&&stop==='yes'&&(body==='yes'||door==='yes'||moving==='yes')&&!(door==='yes'&&moving==='yes')&&other!=='yes'){
  const protection=ask('minorProtected');if(!protection)return result();
  if(protection==='yes')return result({code:'AC02',reason:'Routine minor intervention with effective alternative protection proposed. Verify eligibility and safeguards before execution.',exception:true});
 }
 const loss=ask('loss');if(!loss)return result();
 const infeasible=ask('infeasible');if(!infeasible)return result();
 if(infeasible==='no')return result({code:'AC03',reason:loss==='yes'?'Production loss alone does not justify live work. Full LOTO remains the default.':'Hazardous energy exposure: full LOTO is the default.',exception:false});
 const partial=ask('partial');if(!partial)return result();
 return result(partial==='yes'?{code:'AC06',reason:'Partial LOTO candidate: isolate all energy not technically required and assess retained energy. Independent authorization required.',exception:true}:{code:'AC05',reason:'Live work candidate: independently establish technical infeasibility or increased safety hazard and lawful authorization.',exception:true});
}
export function questionsFor(a:Answers){return taskDecisionPath(a).path;}
export function decideTask(a:Answers){return taskDecisionPath(a).decision;}
export function answerTaskQuestion(a:Answers,key:string,value:string):Answers{
 const state=taskDecisionPath(a);
 if(state.next?.[0]!==key||!['yes','no'].includes(value))return state.answers;
 return taskDecisionPath({...state.answers,[key]:value}).answers;
}
export function backTaskQuestion(a:Answers):Answers{
 const state=taskDecisionPath(a),prior={...state.answers};
 const answered=state.path.filter(([key])=>Object.prototype.hasOwnProperty.call(prior,key));
 const last=answered[answered.length-1];if(last)delete prior[last[0]];
 return taskDecisionPath(prior).answers;
}
export const TASK_ADDITIONAL_CLASSES=['AC04','AC07','AC08','AC09','AC10','AC11','AC12','AC13','AC14','AC15','AC16','AC17','AC18','AC19','AC20','AC21'];
export const EXECUTOR_TYPES=['Operator','Technical operator','Mechanical technician','Electrical / automation technician','Shift specialist','Engineer','Maintenance supervisor','Authorized specialist','External service provider','Multi-disciplinary team'];
export const TASK_PLAN_STATES=['isolate','retained','not_applicable'];

// Optional class-level risk records never block task configuration. A risk-bearing
// task without risk coverage remains pending and is not an authorization to execute.
export function taskRiskAssessmentPending(code:string,ownRows:number,hasGlobalRisks:boolean,noAdditionalRisks:boolean):boolean{
 return !!code&&code!=='AC01'&&ownRows===0&&!(hasGlobalRisks&&noAdditionalRisks);
}
