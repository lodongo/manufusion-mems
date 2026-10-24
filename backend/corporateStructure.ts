/**
 * Corporate operating-model / administrative-home configuration (P1).
 * Pure validation: this is a planning overlay, NOT security, payroll, budget or GL posting.
 */
export type OperatingModel='CEN'|'DEC'|'FED'|'HYB';
export type OverrideScope='legal_entity'|'function'|'function_entity';
export type AssignmentSubject='function'|'position';
export type ModelOverride={
  id:string;scope:OverrideScope;legalEntityId:string;functionCode:string;
  model:OperatingModel;effectiveFrom:string;effectiveTo:string;
};
export type Beneficiary={legalEntityId:string;costCenterId:string;percentage:number};
export type CorporateHomeAssignment={
  id:string;subjectType:AssignmentSubject;subjectCode:string;
  operatingNodeIds:string[];reportingFunctionCode:string;
  employingLegalEntityId:string;administrativeNodeId:string;
  payrollLegalEntityId:string;payingLegalEntityId:string;
  financialLegalEntityId:string;financialCostCenterId:string;
  budgetLegalEntityId:string;budgetCostCenterId:string;
  fundingLegalEntityId:string;beneficiaries:Beneficiary[];
  effectiveFrom:string;effectiveTo:string;rationale:string;
};
export type CorporateStructureDraft={
  defaultModel:OperatingModel;overrides:ModelOverride[];
  assignments:CorporateHomeAssignment[];status:'draft';
};
export type CorporateStructureConfig=CorporateStructureDraft&{
  version:number;updatedAt:string;updatedBy:string;
};
export type StructureNode={
  id:string;code:string;name:string;level:string;parentId:string;status:string;
};
export type StructureReferences={
  nodes:StructureNode[];
  functions:Array<{code:string;name:string;enabled:boolean}>;
  positions:Array<{code:string;name:string}>;
};
export const MODEL_LABELS:ReadonlyArray<{code:OperatingModel;label:string}>= [
  {code:'CEN',label:'Centralized'},
  {code:'DEC',label:'Decentralized'},
  {code:'FED',label:'Federated / Shared Services'},
  {code:'HYB',label:'Hybrid'},
];
const modelSet=new Set<string>(MODEL_LABELS.map(m=>m.code));
const safe=(x:unknown,n=160)=>typeof x==='string'?x.trim().slice(0,n):'';
const txt=(x:unknown,n=500)=>safe(x,n);
const arr=(x:unknown,max=500):unknown[]=>{
  if(!Array.isArray(x)||x.length>max)throw Error('Invalid or oversized configuration list.');
  return x;
};
const rec=(x:unknown):Record<string,unknown>=>{
  if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Invalid configuration entry.');
  return x as Record<string,unknown>;
};
export function validIsoDate(value:string):boolean{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+'T00:00:00.000Z');
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}
const dates=(start:string,end:string)=>{
  if(start&&!validIsoDate(start)||end&&!validIsoDate(end)||end&&start&&end<start)
    throw Error('Effective dates must be valid YYYY-MM-DD values in chronological order.');
};
const overlapping=(a:{effectiveFrom:string;effectiveTo:string},b:{effectiveFrom:string;effectiveTo:string})=>
  (a.effectiveFrom||'0000-01-01')<=(b.effectiveTo||'9999-12-31')&&
  (b.effectiveFrom||'0000-01-01')<=(a.effectiveTo||'9999-12-31');
export const defaultCorporateStructure=():CorporateStructureConfig=>({
  defaultModel:'HYB',overrides:[],assignments:[],
  status:'draft',version:0,updatedAt:'',updatedBy:'',
});
export function modelFor(
  draft:Pick<CorporateStructureDraft,'defaultModel'|'overrides'>,
  legalEntityId:string,functionCode:string,at:string,
):OperatingModel{
  const candidates=draft.overrides.filter(o=>
    (!o.effectiveFrom||o.effectiveFrom<=at)&&(!o.effectiveTo||at<=o.effectiveTo)&&
    (o.scope==='function_entity'?o.legalEntityId===legalEntityId&&o.functionCode===functionCode:
      o.scope==='function'?o.functionCode===functionCode:o.legalEntityId===legalEntityId));
  const precedence:Record<OverrideScope,number>={legal_entity:1,function:2,function_entity:3};
  candidates.sort((a,b)=>precedence[b.scope]-precedence[a.scope]);
  return candidates[0]?.model||draft.defaultModel;
}
export function validateCorporateStructure(input:unknown,refs:StructureReferences):CorporateStructureDraft{
  const x=rec(input);
  const defaultModel=safe(x.defaultModel,3) as OperatingModel;
  if(!modelSet.has(defaultModel))throw Error('Select a valid corporate operating model.');
  const nodes=new Map(refs.nodes.filter(n=>n.status!=='inactive').map(n=>[n.id,n]));
  const entities=new Set(refs.nodes.filter(n=>n.level==='legal_entity'&&n.status!=='inactive').map(n=>n.id));
  const funcs=new Set(refs.functions.filter(f=>f.enabled).map(f=>f.code));
  const positions=new Set(refs.positions.map(p=>p.code));
  const node=(id:string)=>{if(id&&!nodes.has(id))throw Error('Selected organizational unit is unavailable or inactive.');return id;};
  const entity=(id:string)=>{if(id&&!entities.has(id))throw Error('Selected legal entity is unavailable or inactive.');return id;};
  const owningEntity=(id:string):string=>{
    const visited=new Set<string>();
    while(id&&!visited.has(id)){
      visited.add(id);const n=nodes.get(id);
      if(!n)return '';
      if(n.level==='legal_entity')return n.id;
      id=n.parentId;
    }
    return '';
  };
  const center=(id:string,leId:string)=>{
    if(!id)return '';
    const n=nodes.get(id);
    if(!n||n.level!=='cost_center'||!leId||owningEntity(id)!==leId)
      throw Error('Selected cost centre must belong to its declared legal entity.');
    return id;
  };
  const overrideKeys=new Set<string>();
  const overrides:ModelOverride[]=arr(x.overrides,250).map(value=>{
    const v=rec(value),scope=safe(v.scope,32) as OverrideScope;
    if(!['legal_entity','function','function_entity'].includes(scope))
      throw Error('Invalid operating model override scope.');
    const id=safe(v.id,128),model=safe(v.model,3) as OperatingModel;
    if(!id||!modelSet.has(model))throw Error('Override requires an ID and an operating model.');
    const legalEntityId=scope!=='function'?entity(safe(v.legalEntityId,128)):'';
    const functionCode=scope!=='legal_entity'?safe(v.functionCode,30):'';
    if(scope!=='function'&&!legalEntityId||scope!=='legal_entity'&&!funcs.has(functionCode))
      throw Error('Each override must reference the required active function/entity.');
    const effectiveFrom=safe(v.effectiveFrom,10),effectiveTo=safe(v.effectiveTo,10);
    dates(effectiveFrom,effectiveTo);
    const key=[scope,legalEntityId,functionCode].join('|');
    if(overrideKeys.has(id))throw Error('Duplicate override ID.');overrideKeys.add(id);
    return {id,scope,legalEntityId,functionCode,model,effectiveFrom,effectiveTo};
  });
  for(let i=0;i<overrides.length;i++)for(let j=0;j<i;j++){
    const a=overrides[i],b=overrides[j];
    if(a.scope===b.scope&&a.legalEntityId===b.legalEntityId&&
      a.functionCode===b.functionCode&&overlapping(a,b))
      throw Error('Operating-model overrides cannot overlap for the same scope.');
  }
  const assignmentIds=new Set<string>();
  const assignments:CorporateHomeAssignment[]=arr(x.assignments,500).map(value=>{
    const v=rec(value),id=safe(v.id,128);
    const subjectType=safe(v.subjectType,16) as AssignmentSubject;
    const subjectCode=safe(v.subjectCode,80);
    if(!id||assignmentIds.has(id))throw Error('Assignment IDs must be unique and nonempty.');
    assignmentIds.add(id);
    if(subjectType!=='function'&&subjectType!=='position')
      throw Error('Choose a function or position assignment.');
    if(subjectType==='function'?!funcs.has(subjectCode):!positions.has(subjectCode))
      throw Error('Assignment subject must exist in the current corporate functions or position registry.');
    const operatingNodeIds=arr(v.operatingNodeIds,250).map(a=>node(safe(a,128)));
    if(new Set(operatingNodeIds).size!==operatingNodeIds.length)
      throw Error('Duplicate operating coverage unit.');
    const reportingFunctionCode=safe(v.reportingFunctionCode,30);
    if(reportingFunctionCode&&(!funcs.has(reportingFunctionCode)||
      subjectType==='function'&&reportingFunctionCode===subjectCode))
      throw Error('Reporting function must be an existing, distinct corporate function.');
    const employingLegalEntityId=entity(safe(v.employingLegalEntityId,128));
    const administrativeNodeId=node(safe(v.administrativeNodeId,128));
    const payrollLegalEntityId=entity(safe(v.payrollLegalEntityId,128));
    const payingLegalEntityId=entity(safe(v.payingLegalEntityId,128));
    const financialLegalEntityId=entity(safe(v.financialLegalEntityId,128));
    const financialCostCenterId=center(safe(v.financialCostCenterId,128),financialLegalEntityId);
    const budgetLegalEntityId=entity(safe(v.budgetLegalEntityId,128));
    const budgetCostCenterId=center(safe(v.budgetCostCenterId,128),budgetLegalEntityId);
    const fundingLegalEntityId=entity(safe(v.fundingLegalEntityId,128));
    const beneficiaries=arr(v.beneficiaries,250).map(row=>{
      const b=rec(row),legalEntityId=entity(safe(b.legalEntityId,128));
      if(!legalEntityId)throw Error('Beneficiary legal entity is required.');
      const costCenterId=center(safe(b.costCenterId,128),legalEntityId);
      const percentage=Number(b.percentage);
      if(!Number.isFinite(percentage)||percentage<=0||percentage>100)
        throw Error('Beneficiary share must be greater than zero and at most 100%.');
      return {legalEntityId,costCenterId,percentage};
    });
    if(beneficiaries.length){
      if(Math.abs(beneficiaries.reduce((sum,b)=>sum+b.percentage,0)-100)>0.000001)
        throw Error('Beneficiary percentages must total 100%.');
      const keys=beneficiaries.map(b=>b.legalEntityId+'|'+b.costCenterId);
      if(new Set(keys).size!==keys.length)throw Error('Duplicate beneficiary destination.');
    }
    const effectiveFrom=safe(v.effectiveFrom,10),effectiveTo=safe(v.effectiveTo,10);
    dates(effectiveFrom,effectiveTo);
    return {id,subjectType,subjectCode,operatingNodeIds,reportingFunctionCode,
      employingLegalEntityId,administrativeNodeId,payrollLegalEntityId,payingLegalEntityId,
      financialLegalEntityId,financialCostCenterId,budgetLegalEntityId,budgetCostCenterId,
      fundingLegalEntityId,beneficiaries,effectiveFrom,effectiveTo,rationale:txt(v.rationale)};
  });
  for(let i=0;i<assignments.length;i++)for(let j=0;j<i;j++){
    const a=assignments[i],b=assignments[j];
    if(a.subjectType===b.subjectType&&a.subjectCode===b.subjectCode&&overlapping(a,b))
      throw Error('Overlapping primary financial-home drafts for the same function or position are not allowed.');
  }
  return {defaultModel,overrides,assignments,status:'draft'};
}
