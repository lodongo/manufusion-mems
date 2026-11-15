/** Organization-level maintenance governance policy. Drafts are NOT runtime authority.
 * Activation must be connected to the existing approval engine and transaction version snapshots.
 */
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
