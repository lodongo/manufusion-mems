/**
 * P3 shared cost allocation: policy, driver and rounding domain.
 * Planning/calculation only. NO intercompany invoicing, journals, settlement or GL side effects.
 */
export const ALLOCATION_BASIS=[
 {code:'FIXED_PCT',label:'Approved fixed percentages'},
 {code:'TIMESHEET',label:'Approved timesheet hours'},
 {code:'HEADCOUNT',label:'Beneficiary employee headcount'},
 {code:'FTE',label:'Full-time equivalent'},
 {code:'USAGE',label:'Measured service or utility usage'},
 {code:'TRANSACTIONS',label:'Verified transactions handled'},
 {code:'REVENUE',label:'Reported beneficiary revenue'},
 {code:'AREA',label:'Occupied floor area'},
 {code:'DIRECT',label:'Directly attributable costs'},
] as const;
export const POOL_TYPES=[
 {code:'SHARED_SERVICE',label:'Shared service'},
 {code:'DIRECT_SERVICE',label:'Direct charge / project service'},
 {code:'SHAREHOLDER',label:'Shareholder or holding-company-only'},
 {code:'MIXED',label:'Mixed (requires separate cost pools)'},
] as const;
export type AllocationBasis=typeof ALLOCATION_BASIS[number]['code'];
export type CostNature=typeof POOL_TYPES[number]['code'];
export type AllocationBeneficiary={
 legalEntityId:string;costCenterId:string;fixedPercent:number;
 serviceAgreementRef:string;benefitEvidence:string;
};
export type AllocationPolicy={
 id:string;code:string;name:string;
 providerLegalEntityId:string;sourceCostCenterId:string;
 functionCode:string;costNature:CostNature;basis:AllocationBasis;
 beneficiaries:AllocationBeneficiary[];
 glAccountCodes:string[];currency:string;annualCeilingMinor:number;
 effectiveFrom:string;effectiveTo:string;purpose:string;
 driverEvidencePolicy:string;taxPolicyReference:string;pricingPolicy:'AT_COST'|'CONTRACT';
 status:'awaiting_counterparties'|'approved_policy';
 version:number;approvalRef:string;approvedBy:string;approvedAt:string;
 confirmations:Record<string,{approvedBy:string;approvedAt:string;approvalRef:string}>;
};
export type AllocationReferences={
 legalEntities:Array<{id:string;name:string;code:string}>;
 costCenters:Array<{id:string;name:string;code:string;legalEntityId:string}>;
 functions:Array<{code:string;name:string}>;
};
export type AllocationCalculation={
 totalMinor:number;allocatedMinor:number;retainedMinor:number;
 rows:Array<{legalEntityId:string;costCenterId:string;weight:number;sharePercent:number;
  amountMinor:number;intercompany:boolean;agreementRef:string}>;
 requiresIntercompanyProcessing:boolean;previewOnly:true;
};
const basisSet=new Set<string>(ALLOCATION_BASIS.map(x=>x.code));
const costSet=new Set<string>(POOL_TYPES.map(x=>x.code));
export const dateOK=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 !Number.isNaN(new Date(s+'T00:00:00.000Z').getTime())&&new Date(s+'T00:00:00.000Z').toISOString().slice(0,10)===s;
const moneyInt=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const validCode=(x:string)=>/^[A-Z][A-Z0-9_-]{1,30}$/.test(x);
const idKey=(b:{legalEntityId:string;costCenterId:string})=>b.legalEntityId+'|'+b.costCenterId;
export function validateAllocationPolicy(p:AllocationPolicy,refs:AllocationReferences):AllocationPolicy{
 if(!p.id||!validCode(p.code)||!p.name.trim()||!p.purpose.trim())throw Error('Allocation policy needs an ID, code, name and business purpose.');
 if(!basisSet.has(p.basis)||!costSet.has(p.costNature))throw Error('Select a configured allocation basis and cost nature.');
 if(p.costNature==='MIXED')throw Error('Separate mixed shareholder and beneficiary service costs into distinct evidenced cost pools.');
 if(p.costNature==='SHAREHOLDER'&&p.beneficiaries.some(b=>b.legalEntityId!==p.providerLegalEntityId))
  throw Error('Shareholder-only expenses cannot be recharged to subsidiaries.');
 if(!/^[A-Z]{3}$/.test(p.currency)||!moneyInt(p.annualCeilingMinor)||p.annualCeilingMinor<=0)
  throw Error('A positive annual ceiling and currency code are required.');
 if(!dateOK(p.effectiveFrom)||p.effectiveTo&&!dateOK(p.effectiveTo)||
   p.effectiveTo&&p.effectiveTo<p.effectiveFrom)throw Error('Effective dates are invalid.');
 if(!['AT_COST','CONTRACT'].includes(p.pricingPolicy))throw Error('Invalid pricing policy.');
 if(p.pricingPolicy==='CONTRACT'&&!p.taxPolicyReference.trim())
  throw Error('Contract pricing needs documented tax and transfer-pricing policy reference.');
 const les=new Set(refs.legalEntities.map(e=>e.id));
 const centers=new Map(refs.costCenters.map(c=>[c.id,c]));
 if(!les.has(p.providerLegalEntityId))throw Error('Provider legal entity does not exist.');
 if(centers.get(p.sourceCostCenterId)?.legalEntityId!==p.providerLegalEntityId)
  throw Error('Source cost centre must belong to the provider legal entity.');
 if(p.functionCode&&!refs.functions.some(f=>f.code===p.functionCode))
  throw Error('Corporate function does not exist.');
 if(!p.beneficiaries.length||p.beneficiaries.length>100)
  throw Error('Configure 1–100 beneficiary cost centres.');
 const keys=new Set<string>();
 for(const b of p.beneficiaries){
  const key=idKey(b);
  if(keys.has(key))throw Error('Duplicate beneficiary cost centre.');keys.add(key);
  if(!les.has(b.legalEntityId)||centers.get(b.costCenterId)?.legalEntityId!==b.legalEntityId)
   throw Error('Beneficiary cost centre does not belong to its active legal entity.');
  if(!Number.isFinite(b.fixedPercent)||b.fixedPercent<0||b.fixedPercent>100)
   throw Error('Fixed share must be from 0 to 100.');
  if(b.legalEntityId!==p.providerLegalEntityId&&(!b.serviceAgreementRef.trim()||!b.benefitEvidence.trim()))
   throw Error('Cross-company beneficiaries require a service agreement reference and benefit evidence.');
 }
 if(p.basis==='FIXED_PCT'){
  if(Math.abs(p.beneficiaries.reduce((sum,b)=>sum+b.fixedPercent,0)-100)>0.000001)
   throw Error('Fixed percentages must total 100%.');
 }else if(!p.driverEvidencePolicy.trim())
  throw Error('Dynamic allocations require a source of independently verifiable driver evidence.');
 if(new Set(p.glAccountCodes).size!==p.glAccountCodes.length||p.glAccountCodes.length>100)
  throw Error('GL source accounts must be unique (maximum 100).');
 return p;
}
/** Exact minor-unit allocation; largest remainder, stable tie breaking, never over/under allocates. */
export function calculateAllocation(p:AllocationPolicy,totalMinor:number,drivers?:Record<string,number>):AllocationCalculation{
 if(!moneyInt(totalMinor))throw Error('Cost must be a nonnegative integer in currency minor units.');
 if(totalMinor>p.annualCeilingMinor)throw Error('Preview exceeds policy annual ceiling.');
 if(p.costNature==='MIXED')throw Error('Mixed activities must be separated into homogeneous cost pools.');
 const weighted=p.beneficiaries.map(b=>{
  const key=idKey(b);
  const weight=p.basis==='FIXED_PCT'?b.fixedPercent:Number(drivers?.[key]);
  if(!Number.isFinite(weight)||weight<0)throw Error('Each beneficiary needs a nonnegative verified driver quantity.');
  return {beneficiary:b,key,weight};
 });
 if(!weighted.length)throw Error('No beneficiaries selected.');
 const weightTotal=weighted.reduce((sum,x)=>sum+x.weight,0);
 if(!(weightTotal>0))throw Error('Driver total must be greater than zero.');
 const proportional=weighted.map(x=>{
  const exact=totalMinor*x.weight/weightTotal;
  const floor=Math.floor(exact);
  return {...x,amountMinor:floor,remainder:exact-floor};
 });
 const remainderCount=totalMinor-proportional.reduce((s,x)=>s+x.amountMinor,0);
 if(remainderCount<0||remainderCount>proportional.length)
  throw Error('Allocation rounding failed to reconcile.');
 proportional.sort((a,b)=>b.remainder-a.remainder||a.key.localeCompare(b.key));
 for(let i=0;i<remainderCount;i++)proportional[i].amountMinor++;
 proportional.sort((a,b)=>a.key.localeCompare(b.key));
 const rows=proportional.map(x=>({
  legalEntityId:x.beneficiary.legalEntityId,costCenterId:x.beneficiary.costCenterId,
  weight:x.weight,sharePercent:Math.round(x.weight/weightTotal*1e6)/1e4,
  amountMinor:x.amountMinor,
  intercompany:x.beneficiary.legalEntityId!==p.providerLegalEntityId,
  agreementRef:x.beneficiary.serviceAgreementRef,
 }));
 const allocatedMinor=rows.reduce((sum,x)=>sum+x.amountMinor,0);
 if(allocatedMinor!==totalMinor)throw Error('Cost allocation does not reconcile exactly.');
 return {totalMinor,allocatedMinor,retainedMinor:rows.filter(r=>!r.intercompany).reduce((s,r)=>s+r.amountMinor,0),
  rows,requiresIntercompanyProcessing:rows.some(r=>r.intercompany&&r.amountMinor>0),previewOnly:true};
}
export function pendingCounterparties(p:AllocationPolicy):string[]{
 const distinct=new Set(p.beneficiaries.filter(b=>b.legalEntityId!==p.providerLegalEntityId)
  .map(b=>b.legalEntityId));
 return [...distinct].filter(le=>!p.confirmations[le]).sort();
}
export function allocationIsEffective(p:AllocationPolicy,at:string):boolean{
 return p.status==='approved_policy'&&dateOK(at)&&p.effectiveFrom<=at&&
 (!p.effectiveTo||at<=p.effectiveTo)&&pendingCounterparties(p).length===0;
}
