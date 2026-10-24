/**
 * P4 governed intercompany register, bilateral acceptance and settlement planning.
 * CRITICAL: No journal is posted and no bank is touched by any P4 endpoint.
 */
import {HttpError,getDoc,listDocs,nowIso,str,writeDoc,type Fields} from './core';
import {orgRoute,type OrgContext} from './guards';
import {
  chartOf,createRequest,entityOf,fxRate,hashKey,leOf,needEntity,permAt,reasonOf,
  registerHandler,scopeOf,unitsOf,withLock,yearsOf,periodAt,
  type Obj,type Unit,
} from './finCore';
import {moneyMinor,majorFromMinor,minorFactor} from './corporateBudget';
import {icPostingEnabled,postIntercompanyPair,validatePostablePair,pairPath} from './corporateIntercompanyPosting';
import {postedIcReport} from './corporateIntercompanyPostedReport';
import {inspectP6Readiness} from './corporateIntercompanyReadiness';
import {reconcileStaging} from './corporateIntercompanyReconciliation';
import {
 IC_TYPES,IC_ROLES,IC_SETTLEMENT,validateAgreement,validateVoucher,
 previewIntercompany,validateSettlementPlan,accountRequirements,
 type IcAgreement,type IcParty,type IcRole,type IcType,type IcVoucher,type IcAccounts,
 type IcSettlementPlan,
} from './corporateIntercompany';

const root=(org:string)=>'organizations/'+org;
const agreementDir=(org:string)=>root(org)+'/corp_ic_agreements';
const voucherDir=(org:string)=>root(org)+'/corp_ic_vouchers';
const scheduleDir=(org:string)=>root(org)+'/corp_ic_settlement_plans';
const agreementPath=(org:string,id:string)=>agreementDir(org)+'/'+id;
const voucherPath=(org:string,id:string)=>voucherDir(org)+'/'+id;
const schedulePath=(org:string,id:string)=>scheduleDir(org)+'/'+id;
const clean=(v:unknown,max=250)=>str(v).trim().slice(0,max);
const safeId=(v:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(v);
const rec=(v:unknown):Record<string,unknown>=>{
 if(!v||typeof v!=='object'||Array.isArray(v))throw new HttpError(400,'Provide a configuration object.');
 return v as Record<string,unknown>;
};
const array=(v:unknown,max=100):unknown[]=>{
 if(!Array.isArray(v)||v.length>max)throw new HttpError(400,'Invalid or oversized list.');
 return v;
};
function isoDate(v:unknown){return clean(v,10);}
async function permit(ctx:OrgContext,leId:string,perm:string){
 const [units,scope]=await Promise.all([unitsOf(ctx.orgId),scopeOf(ctx)]);
 const le=needEntity(units,scope,leId);
 if(!permAt(ctx,perm,le.id,units,scope))
  throw new HttpError(403,perm+' required for '+le.code+'.');
 return le;
}
async function canRead(ctx:OrgContext,leId:string){
 const [units,scope]=await Promise.all([unitsOf(ctx.orgId),scopeOf(ctx)]);
 const le=needEntity(units,scope,leId);
 if(!['FIN.view','FIN.setup.manage','FIN.setup.approve','FIN.journal.view'].some(p=>permAt(ctx,p,le.id,units,scope)))
  throw new HttpError(403,'Finance access required for '+le.code+'.');
 return le;
}
async function legal(ctx:OrgContext,leId:string){
 const units=await unitsOf(ctx.orgId),le=units.get(leId);
 if(!le||le.level!=='legal_entity'||le.status==='inactive')
  throw new HttpError(400,'The participating legal entity must exist and be active.');
 return le;
}
function sanitizeAccounts(raw:unknown):IcAccounts{
 const x=rec(raw),out:IcAccounts={};
 for(const [role,account] of Object.entries(x)){
  if(!(role in IC_ROLES))throw new HttpError(400,'Unknown IC GL mapping role '+role+'.');
  const code=clean(account,80);
  if(!code)throw new HttpError(400,'IC GL mapping cannot be blank.');
  out[role as IcRole]=code;
 }
 return out;
}
async function validateChart(ctx:OrgContext,a:IcAgreement){
 for(const party of [a.provider,a.beneficiary]){
  await legal(ctx,party.legalEntityId);
  const chart=await chartOf(ctx.orgId,party.legalEntityId);
  const entity=await entityOf(ctx.orgId,party.legalEntityId);
  if(!entity.functionalCurrency)
   throw new HttpError(409,'Configure both parties functional currencies in Finance.');
  for(const [role,code] of Object.entries(party.accounts)){
   const acc=chart.get(code);
   if(!acc||acc.status!=='active'||!acc.postable||acc.statement!==IC_ROLES[role as IcRole])
    throw new HttpError(409,party.legalEntityId+' mapping '+role+' requires an active '+IC_ROLES[role as IcRole]+' GL posting account.');
   if(entity.doc?.data.glScopeConfigured===true&&!Array.isArray(entity.doc.data.allowedGl))
    throw new HttpError(409,'The selected chart of accounts is incomplete.');
   if(entity.doc?.data.glScopeConfigured===true&&
      !(entity.doc.data.allowedGl as string[]).includes(code))
    throw new HttpError(409,'IC GL account '+code+' is not in the entity approved GL selection.');
  }
 }
}
async function amountForApproval(ctx:OrgContext,leId:string,minor:number,currency:string){
 const e=await entityOf(ctx.orgId,leId);
 if(!e.functionalCurrency)throw new HttpError(409,'Functional currency missing.');
 const rate=await fxRate(currency,e.functionalCurrency);
 const equivalentMinor=Math.ceil(majorFromMinor(minor,currency)*rate*minorFactor(e.functionalCurrency)-1e-8);
 if(!Number.isSafeInteger(equivalentMinor)||equivalentMinor<=0)
  throw new HttpError(400,'Converted Finance approval amount is unsupported.');
 return {approvalFxRate:rate,approvalCurrency:e.functionalCurrency,
  approvalAmount:majorFromMinor(equivalentMinor,e.functionalCurrency)};
}
function parseAgreement(raw:unknown):IcAgreement{
 const x=rec(raw),provider=rec(x.provider),beneficiary=rec(x.beneficiary);
 const currency=clean(x.invoiceCurrency,3).toUpperCase();
 let ceilingMinor:number;
 try{ceilingMinor=moneyMinor(Number(x.ceiling),currency);}
 catch(e){throw new HttpError(400,(e as Error).message);}
 const providerId=clean(provider.legalEntityId,128),
  beneficiaryId=clean(beneficiary.legalEntityId,128);
 const code=clean(x.code,41).toUpperCase();
 const allowedTypes=array(x.allowedTypes,IC_TYPES.length).map(v=>clean(v,40) as IcType);
 const id=hashKey('IC|'+providerId+'|'+beneficiaryId+'|'+code);
 const a:IcAgreement={
  id,code,name:clean(x.name,150),provider:{legalEntityId:providerId,accounts:sanitizeAccounts(provider.accounts||{})},
  beneficiary:{legalEntityId:beneficiaryId,accounts:sanitizeAccounts(beneficiary.accounts||{})},
  allowedTypes,invoiceCurrency:currency,ceilingMinor,
  startDate:isoDate(x.startDate),endDate:isoDate(x.endDate),
  settlementPolicy:clean(x.settlementPolicy,30) as IcAgreement['settlementPolicy'],
  pricingPolicy:clean(x.pricingPolicy,20) as IcAgreement['pricingPolicy'],
  taxPolicyReference:clean(x.taxPolicyReference,200),
  transferPricingReference:clean(x.transferPricingReference,200),
  supportingAgreementReference:clean(x.supportingAgreementReference,200),
  purpose:clean(x.purpose,500),status:'awaiting_counterparty',version:1,
  approvedAt:'',approvedBy:'',providerApprovalRef:'',
  counterpartyApprovalRef:'',counterpartyApprovedAt:'',counterpartyApprovedBy:'',
 };
 try{validateAgreement(a);}catch(e){throw new HttpError(400,(e as Error).message);}
 return a;
}
function parseVoucher(raw:unknown,a:IcAgreement,fxP:number,fxB:number,
 currP:string,currB:string):IcVoucher{
 const x=rec(raw),currency=a.invoiceCurrency;
 let amountMinor:number;
 try{amountMinor=moneyMinor(Number(x.amount),currency);}
 catch(e){throw new HttpError(400,(e as Error).message);}
 return {
  id:hashKey('ICV|'+a.id+'|'+clean(x.sourceReference,128)),
  agreementId:a.id,sourceReference:clean(x.sourceReference,128),
  type:clean(x.type,40) as IcType,currency,amountMinor,
  valueDate:isoDate(x.valueDate),providerLegalEntityId:a.provider.legalEntityId,
  beneficiaryLegalEntityId:a.beneficiary.legalEntityId,
  taxReviewReference:clean(x.taxReviewReference,200),
  transferPricingEvidence:clean(x.transferPricingEvidence,200),
  supportingDocumentReferences:array(x.supportingDocumentReferences,50).map(v=>clean(v,160)),
  description:clean(x.description,500),
  providerCostCenterId:clean(x.providerCostCenterId,128),beneficiaryCostCenterId:clean(x.beneficiaryCostCenterId,128),
  allocationPolicyId:clean(x.allocationPolicyId,128),allocationSourceJournalId:clean(x.allocationSourceJournalId,128),
  status:'awaiting_counterparty',createdAt:nowIso(),createdBy:'',
  providerApprovedAt:'',providerApprovalRef:'',
  beneficiaryApprovedAt:'',beneficiaryApprovedBy:'',beneficiaryApprovalRef:'',
  providerFunctionalCurrency:currP,beneficiaryFunctionalCurrency:currB,
  providerFxRate:fxP,beneficiaryFxRate:fxB,
 };
}
async function activeVoucherAtApproval(ctx:OrgContext,v:IcVoucher,a:IcAgreement){
 try{validateVoucher(v,a);}catch(e){throw new HttpError(409,(e as Error).message);}
 if(a.status!=='approved_policy')throw new HttpError(409,'Bilateral agreement approval is required.');
 await validateChart(ctx,a);
 const today=nowIso().slice(0,10);
 if(v.valueDate>today)throw new HttpError(409,'Future-dated intercompany transactions cannot be activated.');
 for(const leId of [v.providerLegalEntityId,v.beneficiaryLegalEntityId]){
  const years=await yearsOf(ctx.orgId,leId);
  const at=periodAt(years,v.valueDate);
  if(!at||at.period.status!=='open')
   throw new HttpError(409,'Both legal entities need an open Finance period covering the voucher value date.');
 }
 const cp=await entityOf(ctx.orgId,v.providerLegalEntityId),
  cb=await entityOf(ctx.orgId,v.beneficiaryLegalEntityId);
 if(cp.functionalCurrency!==v.providerFunctionalCurrency||cb.functionalCurrency!==v.beneficiaryFunctionalCurrency)
  throw new HttpError(409,'A party functional currency changed since proposal.');
 const other=await listDocs(voucherDir(ctx.orgId));
 const used=other.filter(x=>clean(x.data.agreementId)===a.id)
  .reduce((n,x)=>n+Number(x.data.amountMinor||0),0);
 if(used+v.amountMinor>a.ceilingMinor)
  throw new HttpError(409,'Intercompany agreement financial ceiling has been reached.');
 return previewIntercompany(v,a);
}
registerHandler('corp.ic.agreement',{
 label:'Bilateral intercompany agreement / GL mappings',
 approvePerm:'FIN.setup.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const a=rec(req.payload).agreement as IcAgreement;
  if(!a)throw new HttpError(409,'Missing agreement proposal.');
  await permit(ctx,a.provider.legalEntityId,'FIN.setup.approve');
  await validateChart(ctx,a);
  try{validateAgreement(a);}catch(e){throw new HttpError(409,(e as Error).message);}
  const path=agreementPath(ctx.orgId,a.id);
  const approved:IcAgreement={...a,status:'awaiting_counterparty',
   approvedBy:ctx.uid,approvedAt:nowIso(),providerApprovalRef:id};
  if(!await writeDoc(path,approved as unknown as Fields,{exists:false}))
   throw new HttpError(409,'An agreement with this provider, beneficiary and code already exists.');
  return {agreementId:a.id,status:approved.status,
   note:'Policy only. No legal-entity journals, intercompany charges or funds were posted.'};
 },
});
registerHandler('corp.ic.agreement.accept',{
 label:'Beneficiary intercompany contract sign-off',approvePerm:'FIN.setup.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const aid=clean(rec(req.payload).agreementId,128);
  if(!safeId(aid))throw new HttpError(400,'Invalid agreement reference.');
  const path=agreementPath(ctx.orgId,aid),doc=await getDoc(path);
  if(!doc)throw new HttpError(404,'Intercompany agreement not found.');
  const a=doc.data as unknown as IcAgreement;
  if(a.beneficiary.legalEntityId!==clean(req.leId,128)||a.status!=='awaiting_counterparty')
   throw new HttpError(409,'This agreement is not awaiting the beneficiary approval.');
  await permit(ctx,a.beneficiary.legalEntityId,'FIN.setup.approve');
  if(ctx.uid===a.approvedBy)
   throw new HttpError(403,'Provider approver cannot also approve the beneficiary agreement.');
  await validateChart(ctx,a);
  const next:IcAgreement={...a,status:'approved_policy',version:a.version+1,
   counterpartyApprovedBy:ctx.uid,counterpartyApprovedAt:nowIso(),counterpartyApprovalRef:id};
  if(!await writeDoc(path,next as unknown as Fields,{updateTime:doc.updateTime}))
   throw new HttpError(409,'Agreement changed during beneficiary approval.');
  return {agreementId:aid,status:next.status};
 },
});
registerHandler('corp.ic.voucher',{
 label:'Intercompany transaction approval and matching',
 approvePerm:'FIN.post.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const payload=rec(req.payload),v=payload.voucher as IcVoucher;
  if(!v||!safeId(v.id))throw new HttpError(409,'Intercompany voucher is not valid.');
  await permit(ctx,v.providerLegalEntityId,'FIN.post.approve');
  const doc=await getDoc(agreementPath(ctx.orgId,v.agreementId));
  if(!doc)throw new HttpError(409,'Agreement was removed.');
  const a=doc.data as unknown as IcAgreement;
  return withLock(ctx.orgId,'corp_ic_ceiling_'+a.id,async()=>{
   const preview=await activeVoucherAtApproval(ctx,v,a);
   const pending:IcVoucher={...v,createdBy:clean(req.makerUid,128),
    status:'awaiting_counterparty',providerApprovedAt:nowIso(),providerApprovalRef:id};
   if(!await writeDoc(voucherPath(ctx.orgId,v.id),pending as unknown as Fields,{exists:false}))
    throw new HttpError(409,'The source transaction is already registered.');
   return {voucherId:v.id,status:pending.status,
    docCurrency:v.currency,docAmount:majorFromMinor(v.amountMinor,v.currency),
    providerFunctionalAmount:majorFromMinor(preview.provider.functionalAmountMinor,preview.provider.functionalCurrency),
    note:'Bilateral journal INTENTS only; no GL or cash posted.'};
  });
 },
});
registerHandler('corp.ic.voucher.accept',{
 label:'Beneficiary intercompany transaction matching',
 approvePerm:'FIN.post.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const vid=clean(rec(req.payload).voucherId,128),path=voucherPath(ctx.orgId,vid);
  if(!safeId(vid))throw new HttpError(400,'Invalid voucher reference.');
  const doc=await getDoc(path);
  if(!doc)throw new HttpError(404,'Voucher not found.');
  const v=doc.data as unknown as IcVoucher;
  if(v.status!=='awaiting_counterparty'||v.beneficiaryLegalEntityId!==clean(req.leId,128))
   throw new HttpError(409,'Not pending beneficiary matching.');
  await permit(ctx,v.beneficiaryLegalEntityId,'FIN.post.approve');
  const providerRequest=await getDoc(root(ctx.orgId)+'/fin_requests/'+v.providerApprovalRef);
  if([v.createdBy,clean(providerRequest?.data.decidedBy,128)].includes(ctx.uid))
   throw new HttpError(403,'Provider maker/approver cannot independently match the beneficiary entry.');
  const aDoc=await getDoc(agreementPath(ctx.orgId,v.agreementId));
  if(!aDoc)throw new HttpError(409,'Agreement not found.');
  const a=aDoc.data as unknown as IcAgreement;
  await validateChart(ctx,a);
  try{previewIntercompany(v,a);}catch(e){throw new HttpError(409,(e as Error).message);}
  const matched:IcVoucher={...v,status:'matched_ready',beneficiaryApprovedAt:nowIso(),
   beneficiaryApprovedBy:ctx.uid,beneficiaryApprovalRef:id};
  if(!await writeDoc(path,matched as unknown as Fields,{updateTime:doc.updateTime}))
   throw new HttpError(409,'Transaction was modified during approval.');
  return {voucherId:vid,status:matched.status,
   note:'Voucher matched between legal entities, but journal posting/settlement remains disabled.'};
 },
});
registerHandler('corp.ic.post',{
 label:'Atomic bilateral intercompany GL posting',approvePerm:'FIN.post.approve',valued:true,atomicFinalization:true,
 apply:async(ctx,req,id)=>{
  const vid=clean(rec(req.payload).voucherId,128);
  if(!safeId(vid))throw new HttpError(409,'Missing approved bilateral voucher.');
  if(!icPostingEnabled())throw new HttpError(409,'P6 posting requires explicit isolated development release.');
  const pair=await postIntercompanyPair(ctx,vid,id,req._finalApproval as {steps:Record<string,unknown>[];history:Record<string,unknown>[];at:string;note:string});
  return {pairId:pair.id,providerJournal:pair.providerJournalId,beneficiaryJournal:pair.beneficiaryJournalId,
   note:'Both Finance journals, balances and source record committed atomically; no treasury payment was made.'};
 },
});
registerHandler('corp.ic.settlement.plan',{
 label:'Intercompany settlement schedule approval',approvePerm:'FIN.post.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const x=rec(req.payload),voucherId=clean(x.voucherId,128);
  if(!safeId(voucherId))throw new HttpError(400,'Invalid matched voucher.');
  return withLock(ctx.orgId,'corp_ic_settlement_'+voucherId,async()=>{
   const doc=await getDoc(voucherPath(ctx.orgId,voucherId));
   if(!doc)throw new HttpError(404,'Voucher not found.');
   const v=doc.data as unknown as IcVoucher;
   const aDoc=await getDoc(agreementPath(ctx.orgId,v.agreementId));
   if(!aDoc)throw new HttpError(409,'Funding/service agreement not found.');
   const a=aDoc.data as unknown as IcAgreement;
   await permit(ctx,v.beneficiaryLegalEntityId,'FIN.post.approve');
   const plan:IcSettlementPlan={
    id:hashKey('IC_SETTLE|'+id),voucherId,agreementId:v.agreementId,
    currency:v.currency,amountMinor:Number(x.amountMinor),
    plannedDate:clean(x.plannedDate,10),
    method:clean(x.method,30) as IcSettlementPlan['method'],
    paymentReference:clean(x.paymentReference,128),
    reason:clean(req.reason,500),status:'planned_only',approvedAt:nowIso(),approvalRef:id,
   };
   try{validateSettlementPlan(plan,v,a);}catch(e){throw new HttpError(409,(e as Error).message);}
   const other=await listDocs(scheduleDir(ctx.orgId));
   const scheduledMinor=other.filter(x=>clean(x.data.voucherId)===voucherId)
    .reduce((sum,x)=>sum+Number(x.data.amountMinor||0),0);
   if(scheduledMinor+plan.amountMinor>v.amountMinor)
    throw new HttpError(409,'A subsequent settlement plan already uses part of the voucher ceiling. Resubmit a smaller plan.');
   if(!await writeDoc(schedulePath(ctx.orgId,plan.id),plan as unknown as Fields,{exists:false}))
    throw new HttpError(409,'Settlement plan has already been recorded.');
   return {settlementPlanId:plan.id,status:plan.status,
    note:'Plan only; no payment, receivable/payable clearing or cash transfer executed.'};
  });
 },
});
export const corporateIntercompanyRoutes={
 'POST /api/org/corporate/ic/options':[orgRoute('org.corporate.ic.options','FIN.view',async ctx=>{
  const [units,scope]=await Promise.all([unitsOf(ctx.orgId),scopeOf(ctx)]);
  const entities=[...units.values()].filter(u=>u.level==='legal_entity'&&u.status!=='inactive')
   .map(u=>({id:u.id,code:u.code,name:u.name,
    canEdit:permAt(ctx,'FIN.setup.manage',u.id,units,scope),
    canView:['FIN.view','FIN.setup.manage','FIN.setup.approve','FIN.journal.view'].some(p=>permAt(ctx,p,u.id,units,scope))}));
  return {entities,types:IC_TYPES,settlementPolicies:IC_SETTLEMENT,glRoles:IC_ROLES,
   status:icPostingEnabled()?'atomic_posting_dev_optin':'nonposting_policy_and_matching',
   note:'Bilateral journal posting is opt-in on isolated development only; bank settlement and tax invoice execution remain disabled.'};
 })],
 'POST /api/org/corporate/ic/agreements':[orgRoute('org.corporate.ic.agreements','FIN.view',async ctx=>{
  const leId=clean(ctx.body.legalEntityId,128);await canRead(ctx,leId);
  const docs=await listDocs(agreementDir(ctx.orgId));
  return {agreements:docs.map(d=>d.data).filter(d=>
   clean((d.provider as IcParty|undefined)?.legalEntityId)===leId||
   clean((d.beneficiary as IcParty|undefined)?.legalEntityId)===leId)};
 })],
 'POST /api/org/corporate/ic/agreements/propose':[orgRoute('org.corporate.ic.agreements.propose','FIN.setup.manage',async ctx=>{
  const agreement=parseAgreement(ctx.body.agreement);
  await permit(ctx,agreement.provider.legalEntityId,'FIN.setup.manage');
  await validateChart(ctx,agreement);
  if(await getDoc(agreementPath(ctx.orgId,agreement.id)))
   throw new HttpError(409,'This agreement code and legal-entity pair already exists.');
  const authority=await amountForApproval(ctx,agreement.provider.legalEntityId,
    agreement.ceilingMinor,agreement.invoiceCurrency);
  const reason=clean(ctx.body.reason,500);
  if(reason.length<10)throw new HttpError(400,'Provide a detailed agreement justification.');
  return createRequest(ctx,{leId:agreement.provider.legalEntityId,type:'corp.ic.agreement',
   title:'Approve intercompany agreement '+agreement.code,
   summary:agreement.name+' · '+agreement.provider.legalEntityId+' → '+agreement.beneficiary.legalEntityId,
   scopeKey:'corp.ic.agreement.'+agreement.id,
   payload:{agreement,...authority} as unknown as Obj,
   amount:authority.approvalAmount,reason});
 })],
 'POST /api/org/corporate/ic/agreements/accept':[orgRoute('org.corporate.ic.agreements.accept','FIN.setup.manage',async ctx=>{
  const id=clean(ctx.body.agreementId,128),doc=await getDoc(agreementPath(ctx.orgId,id));
  if(!safeId(id)||!doc)throw new HttpError(404,'Agreement not found.');
  const a=doc.data as unknown as IcAgreement;
  await permit(ctx,a.beneficiary.legalEntityId,'FIN.setup.manage');
  if(a.status!=='awaiting_counterparty')throw new HttpError(409,'Already matched or inactive.');
  const authority=await amountForApproval(ctx,a.beneficiary.legalEntityId,a.ceilingMinor,a.invoiceCurrency);
  const reason=clean(ctx.body.reason,500);
  if(reason.length<10)throw new HttpError(400,'Provide a beneficiary acceptance justification.');
  return createRequest(ctx,{leId:a.beneficiary.legalEntityId,type:'corp.ic.agreement.accept',
   title:'Accept intercompany agreement '+a.code,
   summary:'Beneficiary approval for '+a.name,
   scopeKey:'corp.ic.accept.'+a.id,
   payload:{agreementId:a.id,...authority},amount:authority.approvalAmount,reason});
 })],
 'POST /api/org/corporate/ic/vouchers':[orgRoute('org.corporate.ic.vouchers','FIN.view',async ctx=>{
  const leId=clean(ctx.body.legalEntityId,128);await canRead(ctx,leId);
  const docs=await listDocs(voucherDir(ctx.orgId));
  return {vouchers:docs.map(d=>d.data).filter(d=>
   clean(d.providerLegalEntityId)===leId||clean(d.beneficiaryLegalEntityId)===leId)};
 })],
 'POST /api/org/corporate/ic/vouchers/propose':[orgRoute('org.corporate.ic.vouchers.propose','FIN.close.run',async ctx=>{
  const id=clean(ctx.body.agreementId,128),doc=await getDoc(agreementPath(ctx.orgId,id));
  if(!safeId(id)||!doc)throw new HttpError(404,'Intercompany agreement not found.');
  const a=doc.data as unknown as IcAgreement;
  await permit(ctx,a.provider.legalEntityId,'FIN.close.run');
  if(a.status!=='approved_policy')
   throw new HttpError(409,'Both entities must approve the agreement before transactions.');
  const provider=await entityOf(ctx.orgId,a.provider.legalEntityId),
   beneficiary=await entityOf(ctx.orgId,a.beneficiary.legalEntityId);
  const [fxP,fxB]=await Promise.all([
   fxRate(a.invoiceCurrency,provider.functionalCurrency),
   fxRate(a.invoiceCurrency,beneficiary.functionalCurrency)]);
  const voucher=parseVoucher(ctx.body.voucher,a,fxP,fxB,
   provider.functionalCurrency,beneficiary.functionalCurrency);
  try{validateVoucher(voucher,a);}catch(e){throw new HttpError(400,(e as Error).message);}
  await validateChart(ctx,a);
  if(await getDoc(voucherPath(ctx.orgId,voucher.id)))
   throw new HttpError(409,'A voucher already exists for this source in the agreement.');
  const authority=await amountForApproval(ctx,a.provider.legalEntityId,voucher.amountMinor,voucher.currency);
  const reason=clean(ctx.body.reason,500);
  if(reason.length<10)throw new HttpError(400,'Provide supporting intercompany transaction justification.');
  return createRequest(ctx,{leId:a.provider.legalEntityId,type:'corp.ic.voucher',
   title:'Intercompany transaction '+voucher.type,
   summary:voucher.sourceReference+' · '+voucher.currency+' '+majorFromMinor(voucher.amountMinor,voucher.currency),
   scopeKey:'corp.ic.voucher.'+voucher.id,
   payload:{voucher,...authority} as unknown as Obj,
   amount:authority.approvalAmount,reason});
 })],
 'POST /api/org/corporate/ic/vouchers/accept':[orgRoute('org.corporate.ic.vouchers.accept','FIN.close.run',async ctx=>{
  const id=clean(ctx.body.voucherId,128),doc=await getDoc(voucherPath(ctx.orgId,id));
  if(!safeId(id)||!doc)throw new HttpError(404,'Transaction voucher not found.');
  const v=doc.data as unknown as IcVoucher;
  await permit(ctx,v.beneficiaryLegalEntityId,'FIN.close.run');
  if(v.status!=='awaiting_counterparty')throw new HttpError(409,'This transaction no longer awaits matching.');
  const authority=await amountForApproval(ctx,v.beneficiaryLegalEntityId,v.amountMinor,v.currency);
  const reason=clean(ctx.body.reason,500);
  if(reason.length<10)throw new HttpError(400,'Document beneficiary acceptance.');
  return createRequest(ctx,{leId:v.beneficiaryLegalEntityId,type:'corp.ic.voucher.accept',
   title:'Match intercompany transaction '+v.sourceReference,
   summary:v.type+' · '+v.currency+' '+majorFromMinor(v.amountMinor,v.currency),
   scopeKey:'corp.ic.match.'+v.id,
   payload:{voucherId:v.id,...authority},amount:authority.approvalAmount,reason});
 })],
 'POST /api/org/corporate/ic/vouchers/preview':[orgRoute('org.corporate.ic.vouchers.preview','FIN.view',async ctx=>{
  const id=clean(ctx.body.voucherId,128),doc=await getDoc(voucherPath(ctx.orgId,id));
  if(!safeId(id)||!doc)throw new HttpError(404,'Intercompany voucher not found.');
  const v=doc.data as unknown as IcVoucher;
  const {units,scope}=await (async()=>({units:await unitsOf(ctx.orgId),scope:await scopeOf(ctx)}))();
  for(const le of [v.providerLegalEntityId,v.beneficiaryLegalEntityId]){
   if(!['FIN.view','FIN.setup.manage','FIN.setup.approve','FIN.journal.view'].some(p=>permAt(ctx,p,le,units,scope)))
    throw new HttpError(403,'Finance access to both voucher parties is required for bilateral GL preview.');
  }
  const aDoc=await getDoc(agreementPath(ctx.orgId,v.agreementId));
  if(!aDoc)throw new HttpError(409,'Intercompany contract missing.');
  const a=aDoc.data as unknown as IcAgreement;
  await validateChart(ctx,a);
  return {...previewIntercompany(v,a),status:v.status,
   providerApprovalRef:v.providerApprovalRef,beneficiaryApprovalRef:v.beneficiaryApprovalRef};
 })],
 'POST /api/org/corporate/ic/post/status':[orgRoute('org.corporate.ic.post.status','FIN.view',async ctx=>({
  postingEnabled:icPostingEnabled(),
  note:'Atomic dual-entity Finance posting requires explicit isolated development release. No bank or tax invoice execution is included.',
 }))],
 'POST /api/org/corporate/ic/post/readiness':[orgRoute('org.corporate.ic.post.readiness','FIN.view',async ctx=>{
  const vid=clean(ctx.body.voucherId,128);
  if(!safeId(vid))throw new HttpError(400,'Select a valid intercompany voucher.');
  const d=await getDoc(voucherPath(ctx.orgId,vid));
  if(!d)throw new HttpError(404,'Voucher not found.');
  const v=d.data as unknown as IcVoucher;
  // No cross-entity finance configuration may be disclosed to a one-sided observer.
  await canRead(ctx,v.providerLegalEntityId);
  await canRead(ctx,v.beneficiaryLegalEntityId);
  return inspectP6Readiness(ctx.orgId,vid);
 })],
 'POST /api/org/corporate/ic/post/propose':[orgRoute('org.corporate.ic.post.propose','FIN.close.run',async ctx=>{
  const vid=clean(ctx.body.voucherId,128);
  if(!safeId(vid))throw new HttpError(400,'Invalid voucher.');
  const doc=await getDoc(voucherPath(ctx.orgId,vid));
  if(!doc)throw new HttpError(404,'Matched voucher not found.');
  const v=doc.data as unknown as IcVoucher;
  await permit(ctx,v.providerLegalEntityId,'FIN.close.run');
  const aDoc=await getDoc(agreementPath(ctx.orgId,v.agreementId));
  if(!aDoc)throw new HttpError(409,'Intercompany agreement is missing.');
  try{validatePostablePair(v,aDoc.data as unknown as IcAgreement);}catch(e){throw new HttpError(409,(e as Error).message);}
  if(!icPostingEnabled())throw new HttpError(409,'P6 atomic posting is not enabled in this isolated environment.');
  if(await getDoc(pairPath(ctx.orgId,v.id)))throw new HttpError(409,'The voucher already has a posted pair.');
  const authority=await amountForApproval(ctx,v.providerLegalEntityId,v.amountMinor,v.currency);
  return createRequest(ctx,{leId:v.providerLegalEntityId,type:'corp.ic.post',
   scopeKey:'corp.ic.post.'+v.id,title:'Post bilateral IC journal '+v.sourceReference,
   summary:'Paired legal entities: '+v.providerLegalEntityId+' and '+v.beneficiaryLegalEntityId+
    '; '+v.currency+' '+majorFromMinor(v.amountMinor,v.currency),
   payload:{voucherId:v.id,...authority},reason:reasonOf(ctx.body),amount:authority.approvalAmount});
 })],
 'POST /api/org/corporate/ic/posted-reconciliation':[orgRoute('org.corporate.ic.posted-reconciliation','FIN.view',async ctx=>{
  const legalEntityId=clean(ctx.body.legalEntityId,128);
  await canRead(ctx,legalEntityId);
  const report=await postedIcReport(ctx.orgId,legalEntityId);
  const parties=new Set(report.rows.flatMap(row=>[row.providerLegalEntityId,row.beneficiaryLegalEntityId]));
  for(const party of parties)await canRead(ctx,party);
  return report;
 })],
 'POST /api/org/corporate/ic/reconciliation':[orgRoute('org.corporate.ic.reconciliation','FIN.view',async ctx=>{
  const legalEntityId=clean(ctx.body.legalEntityId,128);await canRead(ctx,legalEntityId);
  const [agreements,vouchers,settlements]=await Promise.all([
   listDocs(agreementDir(ctx.orgId)),listDocs(voucherDir(ctx.orgId)),listDocs(scheduleDir(ctx.orgId)),
  ]);
  const visibleVouchers=vouchers.map(d=>d.data as unknown as IcVoucher)
   .filter(v=>[v.providerLegalEntityId,v.beneficiaryLegalEntityId].includes(legalEntityId));
  const contractIds=new Set(visibleVouchers.map(v=>v.agreementId));
  const voucherIds=new Set(visibleVouchers.map(v=>v.id));
  return reconcileStaging(
   agreements.map(d=>d.data as unknown as IcAgreement).filter(a=>contractIds.has(a.id)),
   visibleVouchers,
   settlements.map(d=>d.data as unknown as IcSettlementPlan).filter(s=>voucherIds.has(s.voucherId)),
  );
 })],
 'POST /api/org/corporate/ic/settlements':[orgRoute('org.corporate.ic.settlements','FIN.view',async ctx=>{
  const leId=clean(ctx.body.legalEntityId,128);await canRead(ctx,leId);
  const [docs,vouchers]=await Promise.all([listDocs(scheduleDir(ctx.orgId)),listDocs(voucherDir(ctx.orgId))]);
  const visible=new Set(vouchers.filter(v=>[clean(v.data.providerLegalEntityId),clean(v.data.beneficiaryLegalEntityId)].includes(leId)).map(v=>v.id));
  return {plans:docs.map(d=>d.data).filter(d=>visible.has(clean(d.voucherId)))};
 })],
 'POST /api/org/corporate/ic/settlements/propose':[orgRoute('org.corporate.ic.settlements.propose','FIN.close.run',async ctx=>{
  const voucherId=clean(ctx.body.voucherId,128),doc=await getDoc(voucherPath(ctx.orgId,voucherId));
  if(!safeId(voucherId)||!doc)throw new HttpError(404,'Matched voucher required.');
  const v=doc.data as unknown as IcVoucher;
  await permit(ctx,v.beneficiaryLegalEntityId,'FIN.close.run');
  const aDoc=await getDoc(agreementPath(ctx.orgId,v.agreementId));
  if(!aDoc)throw new HttpError(409,'Agreement no longer exists.');
  const a=aDoc.data as unknown as IcAgreement;
  let amountMinor:number;
  try{amountMinor=moneyMinor(Number(ctx.body.amount),v.currency);}
  catch(e){throw new HttpError(400,(e as Error).message);}
  const plan:IcSettlementPlan={
   id:'preview',voucherId:v.id,agreementId:v.agreementId,currency:v.currency,
   amountMinor,plannedDate:clean(ctx.body.plannedDate,10),
   method:clean(ctx.body.method,30) as IcSettlementPlan['method'],
   paymentReference:clean(ctx.body.paymentReference,128),
   reason:clean(ctx.body.reason,500),status:'planned_only',approvedAt:'',approvalRef:'',
  };
  try{validateSettlementPlan(plan,v,a);}catch(e){throw new HttpError(400,(e as Error).message);}
  // These are *unposted* intents, not financial settlements or cash transfers.
  const existing=await listDocs(scheduleDir(ctx.orgId));
  const planned=existing.filter(d=>clean(d.data.voucherId)===voucherId)
   .reduce((s,d)=>s+Number(d.data.amountMinor||0),0);
  if(planned+amountMinor>v.amountMinor)
   throw new HttpError(409,'Total planned settlement would exceed voucher amount.');
  const authority=await amountForApproval(ctx,v.beneficiaryLegalEntityId,amountMinor,v.currency);
  return createRequest(ctx,{leId:v.beneficiaryLegalEntityId,type:'corp.ic.settlement.plan',
   title:'Plan IC settlement '+v.sourceReference,
   summary:v.currency+' '+majorFromMinor(amountMinor,v.currency)+' · '+plan.method,
   scopeKey:'corp.ic.settlement.'+voucherId,
   payload:{...plan,agreementId:v.agreementId,...authority},amount:authority.approvalAmount,
   reason:plan.reason});
 })],
};
