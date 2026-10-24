/**
 * P5 procurement budget pilot adapter.
 *
 * Disabled by default. A tenant must have an explicitly activated, verified,
 * independently approved budget-control policy. Unsupported transaction
 * types or amended purchase orders FAIL CLOSED while pilot is active.
 *
 * Does not infer GL actuals, VAT, recoverable taxes or inventory valuation.
 * The pilot is limited to verified non-stock service PO amounts.
 */
import {HttpError,getDoc,str} from './core';
import {type OrgContext} from './guards';
import {type Obj,type Write,chartOf,entityOf,fxRate,leOf,periodAt,unitsOf,yearsOf} from './finCore';
import {type BudgetClass,isBudgetClass,minorFactor,currencyDigits} from './corporateBudget';
import {
  prepareCommitmentWrites,type PreparedCommitment,
  commitmentRecordPath,
} from './corporateCommitmentPersistence';
import {type SourceCommitment,type CommitmentLine} from './corporateCommitment';
export const PO_GATE_PATH=(orgId:string)=>'organizations/'+orgId+'/procurement_setup/budget_control';
export type PoGateMode='off'|'service_pilot';
export type PoGatePolicy={
 mode:PoGateMode;
 legalEntityId:string;
 approvalRef:string;
 scope:'service_purchase_orders';
 category:BudgetClass;
 valuation:'po_line_net';
 activationDate:string;
 signedOffBy:string;
 effectiveVersion:1;
};
export type PoLineFact={
 costCenterId:string;type:string;total:number;status?:string;
};
export interface PoPreviewLine{
 leId:string;fy:number;currency:string;
 ccId:string;category:BudgetClass;
 amountMinor:number;
 fxRate:number;
 originalCurrency:string;
 originalTotal:number;
}
const validDate=(x:string)=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(new Date(x+'T00:00:00Z').getTime())&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;

/** The gate may run only on a dedicated development Firebase project and explicit opt-in. */
export function poBudgetServerEnabled(env:Record<string,string|undefined>=process.env):boolean{
 const project=env.MEMS_FIREBASE_PROJECT_ID||'';
 return env.MEMS_PO_BUDGET_PILOT_ENABLED==='true'&&
  /(?:^|[-_])(dev|development|test|staging|sandbox)(?:[-_]|$)/i.test(project)&&
  !/(?:^|[-_])(prod|production|live)(?:[-_]|$)/i.test(project);
}
export function verifyPoGateApproval(policy:PoGatePolicy,approval:Record<string,unknown>|null):void{
 const payload=approval&&typeof approval.payload==='object'&&approval.payload&&!Array.isArray(approval.payload)?
  approval.payload as Record<string,unknown>:{};
 const result=approval&&typeof approval.result==='object'&&approval.result&&!Array.isArray(approval.result)?
  approval.result as Record<string,unknown>:{};
 if(!approval||approval.type!=='corp.po.budget.gate'||approval.status!=='approved'||
  approval.id!==policy.approvalRef||approval.leId!==policy.legalEntityId||
  !approval.decidedBy||approval.decidedBy!==policy.signedOffBy||
  approval.makerUid===approval.decidedBy||
  payload.mode!==policy.mode||payload.legalEntityId!==policy.legalEntityId||
  payload.category!==policy.category||payload.activationDate!==policy.activationDate||
  result.mode!==policy.mode||result.legalEntityId!==policy.legalEntityId)
  throw new HttpError(409,'Budget gate activation has no matching independently approved Finance request.');
}

export function parsePoGatePolicy(data:Record<string,unknown>|null):PoGatePolicy|null{
 if(!data||str(data.mode)==='off'||!str(data.mode))return null;
 if(data.mode!=='service_pilot'||data.scope!=='service_purchase_orders'||data.valuation!=='po_line_net'||
  data.effectiveVersion!==1||!/^[A-Za-z0-9_-]{1,128}$/.test(str(data.legalEntityId))||!/^FCR\d{8}$/.test(str(data.approvalRef))||
  !str(data.signedOffBy)||!validDate(str(data.activationDate))||
  !isBudgetClass(str(data.category)))
  throw new HttpError(409,'Budget gate configuration is incomplete or not approved; posting is blocked.');
 return data as unknown as PoGatePolicy;
}
export function verifyPoServicePilot(lines:readonly PoLineFact[],total:number,policy:PoGatePolicy){
 if(policy.mode!=='service_pilot'||policy.valuation!=='po_line_net')throw new Error('Service budget pilot configuration unavailable.');
 if(!lines.length||lines.length>200)throw new Error('Budget-controlled PO must have 1–200 service lines.');
 if(lines.some(l=>l.type!=='service'||!l.costCenterId))
  throw new Error('Service budget pilot cannot approve materials, assets or unassigned cost centres. Contact Finance.');
 if(lines.some(l=>!Number.isFinite(l.total)||l.total<=0))
  throw new Error('PO line values must be positive for budget reservation.');
 const sum=Math.round(lines.reduce((n,l)=>n+l.total,0)*100)/100;
 if(!Number.isFinite(total)||Math.abs(sum-total)>0.009)
  throw new Error('Server PO total differs from verified service lines; revalidate before approval.');
}
const baseOf=(id:string)=>id.replace(/-V\d+$/,'');
export async function preparePoApprovalBudget(
 ctx:OrgContext,poId:string,po:Obj,now:string,
):Promise<{writes:Write[]; prepared:PreparedCommitment; summary:Obj}|null>{
 const setting=await getDoc(PO_GATE_PATH(ctx.orgId));
 const policy=parsePoGatePolicy(setting?.data||null);
 if(!policy)return null;

 const amendment=!!str(po.amendOf)||/-V(?!1$)\d+$/.test(poId);
 if(amendment)throw new HttpError(409,'Budget-controlled PO amendments require the full lifecycle adapter. Do not override this control.');
 const lines=(Array.isArray(po.lines)?po.lines:[]).filter(x=>x&&typeof x==='object'&&!Array.isArray(x)) as Obj[];
 const facts:PoLineFact[]=lines.map(l=>({
  costCenterId:str(l.costCenterId)||str(l.costCenterCode),
  type:str(l.type),total:Number(l.total),
 }));
 const currency=str(po.currency);
 if(!currency)throw new HttpError(409,'PO currency is required.');
 const units=await unitsOf(ctx.orgId);
 const refs=new Map<string,{leId:string;ccId:string}>();
 const invalidCentres:string[]=[];
 for(const fact of facts){
  const cc=units.get(fact.costCenterId),le=leOf(units,fact.costCenterId);
  if(!cc||cc.level!=='cost_center'||cc.status==='inactive'||!le||le.level!=='legal_entity'||le.status==='inactive'){
   invalidCentres.push(fact.costCenterId);continue;
  }
  refs.set(fact.costCenterId,{leId:le.id,ccId:cc.id});
 }
 const les=[...new Set([...refs.values()].map(x=>x.leId))];
 if(!les.includes(policy.legalEntityId))return null;
 if(invalidCentres.length)throw new HttpError(409,'Every line of a pilot PO must have a valid cost centre and legal entity.');
 try{verifyPoServicePilot(facts,Number(po.total),policy);}
 catch(e){throw new HttpError(409,(e as Error).message);}
 if(!poBudgetServerEnabled())
  throw new HttpError(409,'Budget pilot is not enabled on a verified isolated development server.');
 const fcr=await getDoc('organizations/'+ctx.orgId+'/fin_requests/'+policy.approvalRef);
 verifyPoGateApproval(policy,fcr?{...fcr.data,id:fcr.id}:null);
 if(now.slice(0,10)<policy.activationDate)
  throw new HttpError(409,'Budget gate has not reached its approved activation date.');
 if(les.length!==1)
  throw new HttpError(409,'Split the service PO by legal entity before using the budget pilot.');
 const leId=les[0];
 if(leId!==policy.legalEntityId)throw new HttpError(409,'PO belongs to a different legal entity than the approved pilot.');
 const fin=await entityOf(ctx.orgId,leId);
 if(currencyDigits(currency)!==2||currencyDigits(fin.functionalCurrency)!==2)
  throw new HttpError(409,'Service PO pilot supports only two-decimal document and functional currencies until the GL engine supports other minor units.');
 if(fin.status!=='active'||!fin.functionalCurrency)
  throw new HttpError(409,'Service budget gate requires a live Finance entity and functional currency.');
 const [years,rate,chart]=await Promise.all([yearsOf(ctx.orgId,leId),fxRate(currency,fin.functionalCurrency),chartOf(ctx.orgId,leId)]);
 for(const line of lines){
  const acc=chart.get(str(line.glCode));
  if(!acc||acc.statement!=='PL'||acc.status!=='active'||!acc.postable)
   throw new HttpError(409,'Budget pilot service lines must use active postable P&L expense accounts; capital or prepaid services require a different transaction policy.');
  if(fin.doc?.data.glScopeConfigured===true&&
     !(Array.isArray(fin.doc.data.allowedGl)&&fin.doc.data.allowedGl.includes(acc.code)))
   throw new HttpError(409,'A service expense GL is not in the legal entity approved account selection.');
 }
 const at=periodAt(years,now.slice(0,10));
 if(!at||at.period.status!=='open')
  throw new HttpError(409,'Open fiscal period and approved budget are required at PO approval.');
 const key=new Map<string,CommitmentLine>();
 for(const fact of facts){
  const ccId=refs.get(fact.costCenterId)!.ccId;
  let amountMinor:number;
  try{amountMinor=Math.ceil(fact.total*rate*minorFactor(fin.functionalCurrency)-1e-8);}
  catch{throw new HttpError(409,'PO service amount cannot be converted to Finance currency.');}
  if(!Number.isSafeInteger(amountMinor)||amountMinor<=0)
   throw new HttpError(409,'PO service amount outside safe budget precision.');
  const k=ccId+'|'+policy.category;
  const old=key.get(k);
  key.set(k,{legalEntityId:leId,fy:at.year.fy,currency:fin.functionalCurrency,
   costCenterId:ccId,category:policy.category,amountMinor:amountMinor+(old?.amountMinor||0)});
 }
 const sourceKey=baseOf(poId);
 const source:SourceCommitment={
  sourceKind:'purchase_order',sourceKey,sourceDocumentId:sourceKey,
  version:1,status:'reserved',lines:[...key.values()],exceptionIds:[],
 };
 const prior=await getDoc(commitmentRecordPath(ctx.orgId,'purchase_order',sourceKey));
 if(prior)throw new HttpError(409,'PO already has a budget commitment. Request Finance review rather than duplicate it.');
 const prepared=await prepareCommitmentWrites(ctx.orgId,source,now.slice(0,10));
 return {writes:prepared.writes,prepared,summary:{
  budgetControlled:true,budgetGate:'service_pilot',budgetApprovalRef:policy.approvalRef,
  budgetSource:sourceKey,budgetCurrency:fin.functionalCurrency,budgetLegalEntityId:leId,budgetFy:at.year.fy,
  budgetCommittedMinor:[...key.values()].reduce((n,l)=>n+l.amountMinor,0),budgetFxRate:rate,
  budgetNote:'PO service net commitments only; not VAT, GL actuals or payment authorization.',
 }};
}

/** A cancellation releases the original reservation in the SAME atomic PO commit. */
export async function preparePoCancellationBudget(ctx:OrgContext,poId:string,po:Obj,now:string):
 Promise<{writes:Write[]; summary:Obj}|null>{
 if(po.budgetControlled!==true)return null;
 const sourceKey=baseOf(poId);
 const priorDoc=await getDoc(commitmentRecordPath(ctx.orgId,'purchase_order',sourceKey));
 if(!priorDoc)throw new HttpError(409,'Budget-controlled purchase order is missing its commitment record.');
 const previous=priorDoc.data as unknown as SourceCommitment;
 if(previous.status!=='reserved'||previous.sourceDocumentId!==sourceKey)
  throw new HttpError(409,'Purchase order reservation status does not match its approved document.');
 const release:SourceCommitment={...previous,version:previous.version+1,status:'released',
  lines:[],exceptionIds:[]};
 const prepared=await prepareCommitmentWrites(ctx.orgId,release,now.slice(0,10));
 return {writes:prepared.writes,summary:{
  budgetControlled:true,budgetSource:sourceKey,budgetReleasedAt:now,
  budgetNote:'Unconsumed purchase order reservation released on cancellation.',
 }};
}
