/** P6 dual-legal-entity GL postings. A single atomic Firestore :commit holds
 * BOTH validated journals, balances, source postkeys and immutable pair proof.
 * No bank transfer, tax invoice, treasury settlement, or loan/equity drawdown.
 */
import {HttpError,getDoc,nowIso,type Fields} from './core';
import {type OrgContext} from './guards';
import {P,commit,preparePosting,hashKey,permAt,scopeOf,unitsOf,type PostInput,type PostLine} from './finCore';
import {currencyDigits,majorFromMinor} from './corporateBudget';
import {previewIntercompany,validateAgreement,type IcAgreement,type IcVoucher,type IcJournalPreview,type IcRole} from './corporateIntercompany';

export const POSTABLE_INTERCOMPANY_TYPES=['SERVICE_RECHARGE','COST_REIMBURSEMENT'] as const;
export type IcPostingPair={id:string;voucherId:string;agreementId:string;postedAt:string;postedBy:string;approvalRef:string;providerJournalId:string;beneficiaryJournalId:string;providerLegalEntityId:string;beneficiaryLegalEntityId:string;sourceCurrency:string;sourceAmountMinor:number;providerFunctionalMinor:number;beneficiaryFunctionalMinor:number;status:'posted';};
const root=(org:string)=>'organizations/'+org;
export const pairPath=(org:string,id:string)=>root(org)+'/corp_ic_pairs/'+id;
export const voucherPath=(org:string,id:string)=>root(org)+'/corp_ic_vouchers/'+id;
export const agreementPath=(org:string,id:string)=>root(org)+'/corp_ic_agreements/'+id;
const safe=(x:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(x);
export function icPostingEnabled(env:Record<string,string|undefined>=process.env):boolean{
 const project=env.MEMS_FIREBASE_PROJECT_ID||'';
 return env.MEMS_P6_INTERCOMPANY_POSTING_ENABLED==='true'&&
  /(?:^|[-_])(dev|development|test|staging|sandbox)(?:[-_]|$)/i.test(project)&&
  !/(?:^|[-_])(prod|production|live)(?:[-_]|$)/i.test(project);
}
/** Fails closed until cash/loan/equity posting and indirect tax proof have dedicated controls. */
export function validatePostablePair(v:IcVoucher,a:IcAgreement){
 if(a.status!=='approved_policy'||v.status!=='matched_ready')throw Error('Both entities must approve the agreement and match the voucher before posting.');
 if(!POSTABLE_INTERCOMPANY_TYPES.includes(v.type as typeof POSTABLE_INTERCOMPANY_TYPES[number]))
  throw Error('Loan, equity and bank-related intercompany events require treasury release and are not postable by P6.');
 validateAgreement(a);
 if(v.agreementId!==a.id||v.providerLegalEntityId!==a.provider.legalEntityId||v.beneficiaryLegalEntityId!==a.beneficiary.legalEntityId)
  throw Error('Voucher and approved legal-entity parties differ.');
 if(!v.providerApprovalRef||!v.beneficiaryApprovalRef||!v.beneficiaryApprovedBy)
  throw Error('Both independent financial approval references are mandatory.');
 if(!v.providerCostCenterId&&!v.beneficiaryCostCenterId)throw Error('Explicit service cost-centre mapping is required for both legal entities.');
 if(!v.providerCostCenterId||!v.beneficiaryCostCenterId)throw Error('Both provider and beneficiary cost centres must be configured.');
 if(!v.taxReviewReference||!v.supportingDocumentReferences.length)throw Error('Reviewed tax treatment and supporting document evidence are mandatory.');
 if(currencyDigits(v.currency)!==2||currencyDigits(v.providerFunctionalCurrency)!==2||currencyDigits(v.beneficiaryFunctionalCurrency)!==2)
  throw Error('P6 posting supports two-decimal currencies only until GL minor units are generalized.');
 if(!safe(v.id)||!safe(a.id))throw Error('Invalid source references.');
 const preview=previewIntercompany(v,a);
 if(!Number.isSafeInteger(preview.provider.functionalAmountMinor)||!Number.isSafeInteger(preview.beneficiary.functionalAmountMinor))
  throw Error('FX conversion does not fit safe GL minor units.');
 return preview;
}
export function partyPostingLines(v:IcVoucher,a:IcAgreement,side:'provider'|'beneficiary'):PostLine[]{
 const preview=validatePostablePair(v,a);
 const journal: IcJournalPreview=preview[side];
 const ccId=side==='provider'?v.providerCostCenterId!:v.beneficiaryCostCenterId!;
 return journal.lines.map(l=>({side:l.side,glCode:l.glCode,
   ccId:(l.role==='SERVICE_EXPENSE'||l.role==='SERVICE_RECOVERY')?ccId:'',
   amount:majorFromMinor(l.amountMinor,journal.functionalCurrency),
   docAmount:majorFromMinor(v.amountMinor,v.currency),
   description:'IC '+v.type+' '+v.sourceReference+' / '+a.code,ref:v.id}));
}
export function postingInput(v:IcVoucher,a:IcAgreement,side:'provider'|'beneficiary',approvalRef:string):PostInput{
 const le=side==='provider'?v.providerLegalEntityId:v.beneficiaryLegalEntityId;
 return {leId:le,type:'ICO_CHARGE',date:v.valueDate,docCurrency:v.currency,
  fxRate:side==='provider'?v.providerFxRate:v.beneficiaryFxRate,
  lines:partyPostingLines(v,a,side),narrative:'Bilateral '+v.type+' '+v.sourceReference,
  source:{kind:'intercompany',id:v.id,ref:v.sourceReference,route:'corp.ic.post'},
  trace:{pairId:v.id,agreementId:a.id,party:side,counterparty:side==='provider'?v.beneficiaryLegalEntityId:v.providerLegalEntityId,
   taxReviewReference:v.taxReviewReference,sourceApprovals:[v.providerApprovalRef,v.beneficiaryApprovalRef],
   supportingDocuments:v.supportingDocumentReferences},
  sourceKey:'P6-IC-'+v.id+'-'+side,approvalRef};
}
/** The source and BOTH journals, all balances, periods and postkeys share one commit. */
export type FinalFinanceApproval={steps:Record<string,unknown>[];history:Record<string,unknown>[];at:string;note:string};
export function validateFinalFinanceApproval(meta:FinalFinanceApproval|undefined,uid:string):void{
 if(!meta||!Array.isArray(meta.steps)||!meta.steps.length||
    meta.steps.some(s=>s.status!=='approved')||!Array.isArray(meta.history)||
    !meta.history.length||meta.history[meta.history.length-1].by!==uid||
    typeof meta.at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(meta.at))
  throw new HttpError(409,'The authoritative final Finance approval evidence is missing or invalid.');
}
export async function postIntercompanyPair(ctx:OrgContext,voucherId:string,approvalRef:string,finalApproval:FinalFinanceApproval):Promise<IcPostingPair>{
 if(!icPostingEnabled())throw new HttpError(409,'P6 real intercompany GL posting is disabled on this server.');
 if(!safe(voucherId)||!safe(approvalRef))throw new HttpError(400,'Invalid IC source or approval reference.');
 const vp=voucherPath(ctx.orgId,voucherId),doc=await getDoc(vp);
 if(!doc||!doc.updateTime)throw new HttpError(404,'Matched voucher was not found.');
 const v=doc.data as unknown as IcVoucher;
 const ad=await getDoc(agreementPath(ctx.orgId,v.agreementId));
 if(!ad)throw new HttpError(409,'Signed intercompany agreement not found.');
 const a=ad.data as unknown as IcAgreement;
 try{validatePostablePair(v,a);}catch(e){throw new HttpError(409,(e as Error).message);}
 // Corporate controller must be permitted on BOTH entities, distinct from both bilateral signatories.
 const [units,scope]=await Promise.all([unitsOf(ctx.orgId),scopeOf(ctx)]);
 for(const le of [v.providerLegalEntityId,v.beneficiaryLegalEntityId]){
  if(!permAt(ctx,'FIN.post.approve',le,units,scope))throw new HttpError(403,'Posting authority required for each legal entity.');
 }
 const prov=await getDoc(P(ctx.orgId).request(v.providerApprovalRef));
 const bene=await getDoc(P(ctx.orgId).request(v.beneficiaryApprovalRef));
 if(!prov||!bene||prov.data.status!=='approved'||bene.data.status!=='approved'||
  !['corp.ic.voucher','corp.allocation.execute'].includes(String(prov.data.type))||bene.data.type!=='corp.ic.voucher.accept'||
  prov.data.leId!==v.providerLegalEntityId||bene.data.leId!==v.beneficiaryLegalEntityId)
  throw new HttpError(409,'Voucher must have two valid approved Finance transaction requests.');
 // Bind every independent Finance request to THIS immutable source, not merely to
 // an approved request of the same type in the same legal entity.
 const providerSource=prov.data.payload as Record<string,unknown>|undefined;
 const beneficiarySource=bene.data.payload as Record<string,unknown>|undefined;
 const beneficiaryResult=bene.data.result as Record<string,unknown>|undefined;
 const providerResult=prov.data.result as Record<string,unknown>|undefined;
 const providerVoucher=providerSource?.voucher as Record<string,unknown>|undefined;
 if(beneficiarySource?.voucherId!==v.id||beneficiaryResult?.voucherId!==v.id)
  throw new HttpError(409,'Beneficiary approval proof is not bound to this voucher.');
 if(prov.data.type==='corp.ic.voucher'){
  if(providerVoucher?.id!==v.id||providerResult?.voucherId!==v.id)
   throw new HttpError(409,'Provider approval proof is not bound to this voucher.');
 }else{
  if(!v.allocationPolicyId||!v.allocationSourceJournalId||
      providerResult?.voucherIds==null||
      !Array.isArray(providerResult.voucherIds)||
      !(providerResult.voucherIds as unknown[]).includes(v.id))
   throw new HttpError(409,'Provider allocation approval is not bound to this generated voucher.');
  const alloc=await getDoc(root(ctx.orgId)+'/corp_allocation_runs/'+String(providerResult.runId||''));
  if(!alloc||alloc.data.approvalRef!==v.providerApprovalRef||
     alloc.data.policyId!==v.allocationPolicyId||
     (alloc.data.source as Record<string,unknown>|undefined)?.journalId!==v.allocationSourceJournalId)
   throw new HttpError(409,'Generated voucher is not linked to an executed approved allocation source.');
 }
 if([v.createdBy,v.beneficiaryApprovedBy,prov.data.decidedBy,bene.data.decidedBy].includes(ctx.uid))
  throw new HttpError(403,'Bilateral maker/checker signatories cannot approve final journal posting.');
 if(await getDoc(pairPath(ctx.orgId,v.id)))throw new HttpError(409,'Intercompany voucher has already been posted.');
 const finalFcr=await getDoc(P(ctx.orgId).request(approvalRef));
 if(!finalFcr||!finalFcr.updateTime||finalFcr.data.type!=='corp.ic.post'||finalFcr.data.status!=='pending'||
    finalFcr.data.leId!==v.providerLegalEntityId||
    (finalFcr.data.payload as Record<string,unknown>|undefined)?.voucherId!==v.id||finalFcr.data.makerUid===ctx.uid)
  throw new HttpError(409,'Final Finance approval request cannot be atomically completed with this source.');
 const pendingSteps=Array.isArray(finalFcr.data.steps)?finalFcr.data.steps as Array<Record<string,unknown>>:[];
 if(pendingSteps.filter(x=>x.status==='pending').length!==1)
  throw new HttpError(409,'Final Finance authority step is not the last outstanding approval.');
 validateFinalFinanceApproval(finalApproval,ctx.uid);
 if(finalApproval.steps.length!==pendingSteps.length||
    !pendingSteps.every((step,i)=>step.status==='pending'?
      finalApproval.steps[i].status==='approved'&&finalApproval.steps[i].by===ctx.uid:
      finalApproval.steps[i].status===step.status&&finalApproval.steps[i].by===step.by))
  throw new HttpError(409,'Finance final approval evidence does not match the saved authority steps.');
 const decidedAt=finalApproval.at;
 const updatedSteps=finalApproval.steps;
 const [p,b]=await Promise.all([
  preparePosting(ctx,postingInput(v,a,'provider',approvalRef)),
  preparePosting(ctx,postingInput(v,a,'beneficiary',approvalRef)),
 ]);
 if(p.id===b.id||p.currency!==v.providerFunctionalCurrency||b.currency!==v.beneficiaryFunctionalCurrency)
  throw new HttpError(409,'The bilateral journals or currencies do not match the agreed source.');
 const pair:IcPostingPair={id:v.id,voucherId:v.id,agreementId:a.id,
  postedAt:nowIso(),postedBy:ctx.uid,approvalRef,providerJournalId:p.id,beneficiaryJournalId:b.id,
  providerLegalEntityId:v.providerLegalEntityId,beneficiaryLegalEntityId:v.beneficiaryLegalEntityId,
  sourceCurrency:v.currency,sourceAmountMinor:v.amountMinor,
  providerFunctionalMinor:Math.round(p.dr),beneficiaryFunctionalMinor:Math.round(b.dr),status:'posted'};
 const posted:IcVoucher={...v,status:'posted',postingApprovalRef:approvalRef,postedAt:pair.postedAt,
  providerJournalId:p.id,beneficiaryJournalId:b.id};
 await commit([...p.writes,...b.writes,
  {path:P(ctx.orgId).request(approvalRef),updateTime:finalFcr.updateTime,
   fields:{...finalFcr.data,status:'approved',steps:updatedSteps,history:finalApproval.history,decidedAt,decidedBy:ctx.uid,
    result:{pairId:v.id,providerJournal:p.id,beneficiaryJournal:b.id}}},
  {path:vp,fields:posted as unknown as Record<string,unknown>,updateTime:doc.updateTime},
  {path:pairPath(ctx.orgId,v.id),fields:pair as unknown as Record<string,unknown>,exists:false},
 ]);
 return pair;
}
