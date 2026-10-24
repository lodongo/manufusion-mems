/** P6: evidence-backed allocation of a SINGLE posted, approved P&L expense GL line.
 * Fixed percent is the only executable driver; other drivers stay preview-only
 * until an independently verified period-driver evidence registry is available.
 */
import {HttpError,getDoc,listDocs,nowIso,type Fields} from './core';
import {type OrgContext} from './guards';
import {P,hashKey,commit,preparePosting,fxRate,entityOf,type PostInput,type Write} from './finCore';
import {currencyDigits,majorFromMinor} from './corporateBudget';
import {allocationIsEffective,calculateAllocation,type AllocationPolicy} from './corporateAllocation';
import {icPostingEnabled} from './corporateIntercompanyPosting';
import type {IcVoucher,IcAgreement} from './corporateIntercompany';
export interface AllocationSource {journalId:string;lineNo:number;amountMinor:number;glCode:string;ccId:string;postingDate:string;currency:string;}
export interface AllocationExecution {id:string;policyId:string;source:AllocationSource;totalMinor:number;currency:string;executedAt:string;approvedBy:string;approvalRef:string;sameEntityJournalId:string;voucherIds:string[];status:'executed';}
const root=(org:string)=>'organizations/'+org;
const poolPath=(org:string,id:string)=>root(org)+'/corp_allocation_policies/'+id;
const runDir=(org:string)=>root(org)+'/corp_allocation_runs';
export const allocationRunPath=(org:string,id:string)=>runDir(org)+'/'+id;
export const allocationRunId=(policyId:string,journalId:string,lineNo:number)=>hashKey('P6ALLOC|'+policyId+'|'+journalId+'|'+lineNo);
export type VerifiedPreview={policy:AllocationPolicy;source:AllocationSource;runId:string;allocation:ReturnType<typeof calculateAllocation>};
export async function previewVerifiedAllocation(orgId:string,policyId:string,journalId:string,lineNo:number):Promise<VerifiedPreview>{
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(policyId)||!/^.{3,128}$/.test(journalId)||!Number.isSafeInteger(lineNo)||lineNo<1)
  throw new HttpError(400,'Select a valid approved pool, source journal and expense line.');
 const [pool,doc]=await Promise.all([getDoc(poolPath(orgId,policyId)),getDoc(P(orgId).journal(journalId))]);
 if(!pool||!doc)throw new HttpError(404,'Approved pool or posted Finance source journal is missing.');
 const p=pool.data as unknown as AllocationPolicy,j=doc.data;
 if(p.status!=='approved_policy'||p.basis!=='FIXED_PCT')throw new HttpError(409,'Only approved fixed-percentage cost pools can be executed until dynamic driver evidence is verified.');
 if(j.leId!==p.providerLegalEntityId||j.currency!==p.currency||currencyDigits(p.currency)!==2)
  throw new HttpError(409,'Source must be a posted journal from the provider in its two-decimal functional currency.');
 if(['ICO_CHARGE','REALLOC','YE_CLOSE','FX_REVAL'].includes(String(j.type)))
  throw new HttpError(409,'Generated, closing and FX revaluation journals cannot be allocated again.');
 const lines=Array.isArray(j.lines)?j.lines as Record<string,unknown>[]:[];
 const found=lines.filter(x=>x.no===lineNo);
 if(found.length!==1)throw new HttpError(409,'Source journal line number is absent or duplicated.');
 const line=found[0];
 if(line.side!=='D'||line.statement!=='PL'||line.ccId!==p.sourceCostCenterId||
    !p.glAccountCodes.includes(String(line.glCode)))
  throw new HttpError(409,'Selected cost is not an approved posted P&L debit in the pool source cost centre and GL mapping.');
 const amount=Number(line.amount),minor=Math.round(amount*100);
 if(!Number.isSafeInteger(minor)||minor<=0||Math.abs(amount-minor/100)>0.000001)
  throw new HttpError(409,'Posted source expense amount is not in supported minor-unit precision.');
 const date=String(j.postingDate),id=allocationRunId(policyId,journalId,lineNo);
 if(!allocationIsEffective(p,date))throw new HttpError(409,'The bilateral allocation policy was not effective on the original expense date.');
 let allocation:ReturnType<typeof calculateAllocation>;
 try{allocation=calculateAllocation(p,minor);}catch(e){throw new HttpError(409,(e as Error).message);}
 return {policy:p,source:{journalId,lineNo,amountMinor:minor,glCode:String(line.glCode),ccId:String(line.ccId),postingDate:date,currency:p.currency},
  runId:id,allocation};
}
export async function executeVerifiedAllocation(ctx:OrgContext,preview:VerifiedPreview,approvalRef:string,taxRef:string,makerUid:string):Promise<AllocationExecution>{
 if(!icPostingEnabled())throw new HttpError(409,'P6 allocation execution is disabled on this server.');
 if(!/^[A-Za-z0-9_-]{3,128}$/.test(approvalRef)||taxRef.trim().length<6)
  throw new HttpError(409,'Approved Finance request and tax review reference are required.');
 const refreshed=await previewVerifiedAllocation(ctx.orgId,preview.policy.id,preview.source.journalId,preview.source.lineNo);
 if(refreshed.source.amountMinor!==preview.source.amountMinor||refreshed.runId!==preview.runId)
  throw new HttpError(409,'Allocation source changed since the Finance approval request.');
 if(await getDoc(allocationRunPath(ctx.orgId,preview.runId)))throw new HttpError(409,'Expense GL line was already allocated under this policy.');
 const internal=refreshed.allocation.rows.filter(x=>!x.intercompany&&x.costCenterId!==refreshed.source.ccId&&x.amountMinor>0);
 const external=refreshed.allocation.rows.filter(x=>x.intercompany&&x.amountMinor>0);
 const rows=internal.flatMap(x=>[
  {side:'D' as const,glCode:refreshed.source.glCode,ccId:x.costCenterId,amount:majorFromMinor(x.amountMinor,refreshed.source.currency),description:'P6 internal allocation '+refreshed.runId},
  {side:'C' as const,glCode:refreshed.source.glCode,ccId:refreshed.source.ccId,amount:majorFromMinor(x.amountMinor,refreshed.source.currency),description:'P6 internal allocation '+refreshed.runId},
 ]);
 const agreements=(await listDocs(root(ctx.orgId)+'/corp_ic_agreements')).map(x=>x.data as unknown as IcAgreement);
 const voucherWrites:Write[]=[];const voucherIds:string[]=[];
 for(const x of external){
  const b=refreshed.policy.beneficiaries.find(y=>y.legalEntityId===x.legalEntityId&&y.costCenterId===x.costCenterId);
  if(!b)throw new HttpError(409,'Allocation recipient changed.');
  const matching=agreements.filter(a=>a.code===b.serviceAgreementRef&&
   a.provider.legalEntityId===refreshed.policy.providerLegalEntityId&&
   a.beneficiary.legalEntityId===x.legalEntityId&&a.status==='approved_policy'&&
   a.allowedTypes.includes('SERVICE_RECHARGE')&&a.invoiceCurrency===refreshed.policy.currency&&
   a.startDate<=refreshed.source.postingDate&&(!a.endDate||a.endDate>=refreshed.source.postingDate));
  if(matching.length!==1)throw new HttpError(409,'One approved intercompany recharge agreement must match beneficiary, currency, dates and service agreement reference.');
  const a=matching[0];
  const beneficiaryCurrency=(await entityOf(ctx.orgId,x.legalEntityId)).functionalCurrency;
  const fx=await fxRate(refreshed.policy.currency,beneficiaryCurrency);
  if(currencyDigits(beneficiaryCurrency)!==2)throw new HttpError(409,'Beneficiary ledger currency is not supported by the two-decimal P6 GL.');
  const id=hashKey('P6ALLOCV|'+refreshed.runId+'|'+x.legalEntityId+'|'+x.costCenterId);
  const v:IcVoucher={id,agreementId:a.id,sourceReference:'ALLOC-'+refreshed.runId+'-'+x.costCenterId,
   type:'SERVICE_RECHARGE',currency:refreshed.policy.currency,amountMinor:x.amountMinor,
   valueDate:refreshed.source.postingDate,providerLegalEntityId:a.provider.legalEntityId,beneficiaryLegalEntityId:a.beneficiary.legalEntityId,
   taxReviewReference:taxRef,transferPricingEvidence:refreshed.policy.pricingPolicy==='CONTRACT'?refreshed.policy.taxPolicyReference:'',
   supportingDocumentReferences:['FINJ-'+refreshed.source.journalId,'POOL-'+refreshed.policy.id],
   description:'Approved shared cost allocation '+refreshed.policy.code,status:'awaiting_counterparty',
   createdAt:nowIso(),createdBy:makerUid,providerApprovedAt:nowIso(),providerApprovalRef:approvalRef,
   beneficiaryApprovedAt:'',beneficiaryApprovedBy:'',beneficiaryApprovalRef:'',
   providerFunctionalCurrency:refreshed.policy.currency,beneficiaryFunctionalCurrency:beneficiaryCurrency,
   providerFxRate:1,beneficiaryFxRate:fx,providerCostCenterId:refreshed.source.ccId,beneficiaryCostCenterId:x.costCenterId,
   allocationPolicyId:refreshed.policy.id,allocationSourceJournalId:refreshed.source.journalId};
  voucherWrites.push({path:root(ctx.orgId)+'/corp_ic_vouchers/'+id,exists:false,fields:v as unknown as Record<string,unknown>});
  voucherIds.push(id);
 }
 // Guard source evidence globally and policy annual cap with optimistic Firestore CAS.
 const policyDoc=await getDoc(poolPath(ctx.orgId,refreshed.policy.id));
 if(!policyDoc||!policyDoc.updateTime||policyDoc.data.status!=='approved_policy')
  throw new HttpError(409,'Approved allocation policy was changed or removed.');
 const spent=Number(policyDoc.data.allocatedToDateMinor||0);
 if(!Number.isSafeInteger(spent)||spent<0||spent+refreshed.source.amountMinor>refreshed.policy.annualCeilingMinor)
  throw new HttpError(409,'Allocation policy annual ceiling has been exhausted.');
 const claimPath=root(ctx.orgId)+'/corp_allocation_source_claims/'+hashKey(refreshed.policy.providerLegalEntityId+'|'+refreshed.source.journalId+'|'+refreshed.source.lineNo);
 const postInput:PostInput={leId:refreshed.policy.providerLegalEntityId,type:'REALLOC',date:refreshed.source.postingDate,
  docCurrency:refreshed.source.currency,fxRate:1,lines:rows,narrative:'Verified P6 allocation '+refreshed.policy.code,
  source:{kind:'corporate-allocation',id:refreshed.runId,ref:refreshed.source.journalId,route:'corp.allocation.execute'},
  sourceKey:'P6ALLOC-'+refreshed.runId,approvalRef};
 const internalPosting=rows.length?await preparePosting(ctx,postInput):null;
 const outcome:AllocationExecution={id:refreshed.runId,policyId:refreshed.policy.id,source:refreshed.source,
  totalMinor:refreshed.source.amountMinor,currency:refreshed.source.currency,executedAt:nowIso(),
  approvedBy:ctx.uid,approvalRef,sameEntityJournalId:internalPosting?.id||'',voucherIds,status:'executed'};
 await commit([...(internalPosting?.writes||[]),...voucherWrites,
  {path:poolPath(ctx.orgId,refreshed.policy.id),updateTime:policyDoc.updateTime,
   mask:['allocatedToDateMinor','lastAllocationAt'],fields:{allocatedToDateMinor:spent+refreshed.source.amountMinor,lastAllocationAt:nowIso()}},
  {path:claimPath,exists:false,fields:{runId:outcome.id,sourceJournalId:refreshed.source.journalId,sourceLineNo:refreshed.source.lineNo}},
  {path:allocationRunPath(ctx.orgId,outcome.id),exists:false,fields:outcome as unknown as Record<string,unknown>}]);
 return outcome;
}
