/** Organization-level maintenance policy. Only explicitly activated, supported policies may be snapshotted. */
export const MAINTENANCE_APPROVALS=['workRequest','workOrder','technicalClosure'] as const;
export type ApprovalKey=typeof MAINTENANCE_APPROVALS[number];
export const WO_APPROVAL_STAGES=['before_assessment','after_assessment','after_readiness','before_execution'] as const;
export type WOApprovalStage=typeof WO_APPROVAL_STAGES[number];
export const CONDITION_FIELDS=['maintenanceType','priority','criticality','estimatedCost','riskScore','requiresSpares','requiresExternalService','requiresExternalSpecialist'] as const;
export type ConditionField=typeof CONDITION_FIELDS[number];
export type Condition={field:ConditionField;op:'eq'|'gte'|'lte';value:string|number|boolean};
export type ApprovalRule={enabled:boolean;match:'all'|'any';conditions:Condition[]};
export type GovernancePolicy={workRequest:ApprovalRule;workOrder:ApprovalRule;technicalClosure:ApprovalRule;workOrderStage:WOApprovalStage};
const object=(x:unknown):Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const rule=():ApprovalRule=>({enabled:false,match:'all',conditions:[]});
export const defaultMaintenanceGovernance=():GovernancePolicy=>({workRequest:rule(),workOrder:rule(),technicalClosure:rule(),workOrderStage:'after_assessment'});
export const MAINTENANCE_APPROVAL_TRANSACTION_CODES:Record<ApprovalKey,string>={workRequest:'MNT-WRQ-AP',workOrder:'MNT-WOR-AP',technicalClosure:'MNT-WOR-CL'};
function validateCondition(raw:unknown):Condition{
 const c=object(raw),field=c.field as ConditionField,op=c.op as Condition['op'],value=c.value;
 if(!CONDITION_FIELDS.includes(field))throw Error('Unknown maintenance approval condition.');
 const numeric=field==='estimatedCost'||field==='riskScore';
 const boolean=field.startsWith('requires');
 if(numeric){if(!['eq','gte','lte'].includes(op)||typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Enter a nonnegative numeric threshold.');}
 else if(boolean){if(op!=='eq'||typeof value!=='boolean')throw Error('Resource conditions must be Yes or No.');}
 else if(op!=='eq'||typeof value!=='string'||!value.trim()||value.length>120)throw Error('Enter a valid master-data code for the condition.');
 return {field,op,value:typeof value==='string'?value.trim():value as number|boolean};
}
export function validateMaintenanceGovernance(raw:unknown):GovernancePolicy{
 const data=object(raw),out=defaultMaintenanceGovernance();
 if(!WO_APPROVAL_STAGES.includes(data.workOrderStage as WOApprovalStage))throw Error('Choose a valid work order approval stage.');
 out.workOrderStage=data.workOrderStage as WOApprovalStage;
 for(const k of MAINTENANCE_APPROVALS){
  const r=object(data[k]);
  if(typeof r.enabled!=='boolean'||(r.match!=='all'&&r.match!=='any')||!Array.isArray(r.conditions)||r.conditions.length>20)throw Error('Each approval must specify enablement, a condition matching method and up to 20 conditions.');
  out[k]={enabled:r.enabled,match:r.match,conditions:r.conditions.map(validateCondition)};
 }
 return out;
}
/** Unknown values must not accidentally authorize a transaction. No conditions = unconditional. */
export function approvalRequirement(r:ApprovalRule,facts:Partial<Record<ConditionField,string|number|boolean>>):'required'|'not_required'|'undetermined'{
 if(!r.enabled)return 'not_required';
 if(!r.conditions.length)return 'required';
 const matches=r.conditions.map(c=>{
  const actual=facts[c.field];
  if(actual===undefined||actual===null||typeof actual!==typeof c.value||typeof actual==='number'&&!Number.isFinite(actual))return null;
  if(c.op==='eq')return actual===c.value;
  if(typeof actual!=='number'||typeof c.value!=='number')return null;
  return c.op==='gte'?actual>=c.value:actual<=c.value;
 });
 if(r.match==='all'){if(matches.includes(false))return 'not_required';return matches.includes(null)?'undetermined':'required';}
 if(matches.includes(true))return 'required';
 return matches.includes(null)?'undetermined':'not_required';
}

export function maintenanceActivationBlockers(_p:GovernancePolicy):string[]{return [];}
export type MaintenancePolicySnapshot={version:number;activatedAt:string;policy:GovernancePolicy};
export function readMaintenancePolicySnapshot(raw:unknown):MaintenancePolicySnapshot|null{
 if(raw===undefined||raw===null)return null;
 const d=object(raw);
 if(!Number.isSafeInteger(d.version)||Number(d.version)<0||typeof d.activatedAt!=='string'||!d.activatedAt)throw Error('Invalid maintenance governance snapshot.');
 return {version:Number(d.version),activatedAt:d.activatedAt,policy:validateMaintenanceGovernance(d.policy)};
}
export function recordFacts(d:Record<string,unknown>):Partial<Record<ConditionField,string|number|boolean>>{
 const facts:Partial<Record<ConditionField,string|number|boolean>>={};
 for(const [k,f] of [['maintenanceType','maintenanceTypeCode'],['priority','priorityCode'],['criticality','criticalityCode']] as const){
  if(typeof d[f]==='string'&&d[f])facts[k]=d[f] as string;
 }
 const tasks=Array.isArray(d.assessmentTasks)?d.assessmentTasks.map(object):[];
 if(tasks.length&&Number(d.assessmentTasksVersion)>0&&d.assessmentTasksAt){
  facts.requiresSpares=tasks.some(t=>Array.isArray(t.spares)&&t.spares.length>0);
  facts.requiresExternalService=tasks.some(t=>Array.isArray(t.services)&&t.services.length>0);
  facts.requiresExternalSpecialist=tasks.some(t=>!!object(t.externalResource).type);
  // The persisted before-mitigation scores are server-calculated using the adopted risk matrix.
  const hazards=tasks.flatMap(t=>Array.isArray(t.risk)?t.risk.map(object):[]);
  const scores=hazards.map(h=>object(h.beforeScore).score);
  if(scores.length&&scores.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))facts.riskScore=Math.max(...scores as number[]);
  // Prefer a persisted current finance-submitted estimate including approved allowances.
  const ca=object(d.costApproval);
  if(['pending','approved'].includes(String(ca.status))&&Number(ca.version)===Number(d.assessmentTasksVersion)&&typeof ca.amount==='number'&&Number.isFinite(ca.amount)&&ca.amount>=0){
   facts.estimatedCost=ca.amount;
  }else{
   let total=0,known=true;
   const amount=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
   for(const task of tasks){
    const persons=amount(task.persons),hours=amount(task.hours),rate=amount(task.rate);
    if(persons===null||hours===null||(persons*hours>0&&(rate===null||rate===0)))known=false;
    else total+=persons*hours*(rate??0);
    if(object(task.externalResource).type)known=false;
    for(const spare of (Array.isArray(task.spares)?task.spares.map(object):[])){
     const unitCost=amount(spare.unitCost),qty=amount(spare.qty);
     if(unitCost===null||unitCost===0||qty===null)known=false;else total+=unitCost*qty;
    }
    for(const service of (Array.isArray(task.services)?task.services.map(object):[])){
     const cost=amount(service.expectedCost);if(cost===null)known=false;else total+=cost;
    }
   }
   const allowance=amount(object(d.costPlan).allowance)??0;
   if(known&&Number.isFinite(total+allowance))facts.estimatedCost=Math.round((total+allowance+Number.EPSILON)*100)/100;
  }
 }
 return facts;
}
/** Legacy records retain their review path. Unknown facts or invalid snapshots never bypass review. */
export function maintenanceAssessmentApprovalRequired(d:Record<string,unknown>):boolean{
 if(d.executionMode!=='confirmed_request')return true;
 try{
  const snap=readMaintenancePolicySnapshot(d.maintenanceGovernance);
  if(!snap||maintenanceActivationBlockers(snap.policy).length)return true;
  return snap.policy.workOrderStage==='after_assessment'&&approvalRequirement(snap.policy.workOrder,recordFacts(d))!=='not_required';
 }catch{return true;}
}

/** Later/earlier WO approval is independent of the technical assessment review. */
export function configuredOrderApprovalStage(d:Record<string,unknown>):Exclude<WOApprovalStage,'after_assessment'>|null{
 if(d.executionMode!=='confirmed_request')return null;
 const snap=readMaintenancePolicySnapshot(d.maintenanceGovernance);
 if(!snap||maintenanceActivationBlockers(snap.policy).length||snap.policy.workOrderStage==='after_assessment')return null;
 const initial=object(d.initialApprovalFacts);
 const facts=snap.policy.workOrderStage==='before_assessment'&&d.initialApprovalFacts!==undefined?Object.fromEntries(Object.entries(initial).filter(([k,v])=>CONDITION_FIELDS.includes(k as ConditionField)&&['string','number','boolean'].includes(typeof v)&&v!=='')) as Partial<Record<ConditionField,string|number|boolean>>:recordFacts(d);
 return approvalRequirement(snap.policy.workOrder,facts)==='not_required'?null:snap.policy.workOrderStage;
}

/** Request approval uses facts known at confirmation. Missing facts require approval, never bypass it. */
export function workRequestApprovalRequired(d:Record<string,unknown>,maintenanceTypeCode:string):boolean{
 const snap=readMaintenancePolicySnapshot(d.maintenanceGovernance);
 if(!snap)return false;
 return approvalRequirement(snap.policy.workRequest,recordFacts({...d,maintenanceTypeCode}))!=='not_required';
}

/** Existing transactions without a snapshot retain safety-only closure. */
export function technicalClosureApprovalRequired(d:Record<string,unknown>):boolean{
 const snap=readMaintenancePolicySnapshot(d.maintenanceGovernance);
 if(!snap)return false;
 return approvalRequirement(snap.policy.technicalClosure,recordFacts(d))!=='not_required';
}
