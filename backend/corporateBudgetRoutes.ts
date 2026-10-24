/**
 * P2 corporate budget and funding workflows.
 * Uses existing Finance maker/checker (FCR requests, CoA bands, SoD).
 * No API here posts GL, commits procurement spend, transfers cash or changes payroll.
 */
import {HttpError,getDoc,listDocs,nowIso,str,writeDoc,type Fields} from './core';
import {orgRoute,type OrgContext} from './guards';
import {
  commit,createRequest,entityOf,hashKey,leOf,needEntity,permAt,reasonOf,registerHandler,
  requireFinance,scopeOf,unitsOf,withLock,yearsOf,today,
  type Obj,type Unit,
} from './finCore';
import {
  applyApprovedRevision,applyApprovedTransfer,BUDGET_CLASSES,FUNDING_METHODS,isBudgetClass,isFundingMethod,
  moneyMinor,majorFromMinor,validDate,validateFundingAgreement,validateNewPlan,checkBudget,
  type BudgetLine,type BudgetPlan,type BudgetTransfer,type BudgetRevision,type BudgetException,
  type BudgetClass,type FundingAgreement,type FundingMethod,
} from './corporateBudget';

const root=(org:string)=>'organizations/'+org;
const planPath=(org:string,le:string,fy:number)=>root(org)+'/corp_budgets/'+le+'_'+fy;
const movePath=(org:string,id:string)=>root(org)+'/corp_budget_moves/'+id;
const revisionPath=(org:string,id:string)=>root(org)+'/corp_budget_revisions/'+id;
const exceptionPath=(org:string,id:string)=>root(org)+'/corp_budget_exceptions/'+id;
const fundingPath=(org:string,id:string)=>root(org)+'/corp_funding_agreements/'+id;
const clean=(value:unknown,max=250)=>str(value).trim().slice(0,max);
const safeId=(id:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(id);
const getObject=(raw:unknown):Record<string,unknown>=>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpError(400,'Provide an object.');
 return raw as Record<string,unknown>;
};
const amount=(raw:unknown,currency:string)=>{try{return moneyMinor(raw,currency);}catch(e){throw new HttpError(400,(e as Error).message);}};
const moneyNumber=(minor:number,currency:string)=>majorFromMinor(minor,currency);
const integer=(raw:unknown)=>{
 const v=Number(raw);
 if(!Number.isSafeInteger(v)||v<1900||v>2500)throw new HttpError(400,'Invalid financial year.');
 return v;
};
const category=(raw:unknown)=>{
 const c=clean(raw,20);
 if(!isBudgetClass(c))throw new HttpError(400,'Select an approved budget category.');
 return c;
};
const safeReason=(ctx:OrgContext)=>reasonOf(ctx.body,10);
type Context={units:Map<string,Unit>;le:Unit;scope:Awaited<ReturnType<typeof scopeOf>>};
async function setup(ctx:OrgContext,leId:string,permission:string):Promise<Context>{
 const [units,scope]=await Promise.all([unitsOf(ctx.orgId),scopeOf(ctx)]);
 const le=needEntity(units,scope,leId);
 if(!permAt(ctx,permission,le.id,units,scope))
   throw new HttpError(403,permission+' is required for legal entity '+le.code+'.');
 return {units,scope,le};
}
const costCenterOf=(ccId:string,le:string,units:Map<string,Unit>)=>{
 const cc=units.get(ccId);
 if(!cc||cc.level!=='cost_center'||cc.status==='inactive'||leOf(units,ccId)?.id!==le)
   throw new HttpError(400,'Cost centre must be active and belong to the selected legal entity.');
 return cc;
};
async function yearCurrency(ctx:OrgContext,leId:string,fy:number){
 const [years,fin]=await Promise.all([yearsOf(ctx.orgId,leId),entityOf(ctx.orgId,leId)]);
 const year=years.find(x=>x.fy===fy&&x.status!=='closed');
 if(!year)throw new HttpError(409,'Configure the financial year under Finance before budgeting.');
 if(!fin.functionalCurrency)throw new HttpError(409,'Configure the legal-entity functional currency first.');
 return {fy,currency:fin.functionalCurrency};
}
async function getPlan(ctx:OrgContext,le:string,fy:number):Promise<BudgetPlan|null>{
 const d=await getDoc(planPath(ctx.orgId,le,fy));
 return d?d.data as unknown as BudgetPlan:null;
}
function verifyBudgetLines(raw:unknown,le:string,currency:string,units:Map<string,Unit>):BudgetLine[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>200)throw new HttpError(400,'Provide 1–200 budget lines.');
 const lines=raw.map(r=>{
   const b=getObject(r);const cc=clean(b.costCenterId,128);costCenterOf(cc,le,units);
   return {costCenterId:cc,category:category(b.category),approvedMinor:amount(b.amount,currency),
    adjustmentsMinor:0,committedMinor:0,actualMinor:0};
 });
 try{return validateNewPlan(lines);}catch(e){throw new HttpError(400,(e as Error).message);}
}
function transferInput(body:Record<string,unknown>,le:string,fy:number,currency:string,units:Map<string,Unit>):BudgetTransfer{
 const fromCostCenterId=clean(body.fromCostCenterId,128),toCostCenterId=clean(body.toCostCenterId,128);
 costCenterOf(fromCostCenterId,le,units);costCenterOf(toCostCenterId,le,units);
 const value=amount(body.amount,currency);
 if(!value)throw new HttpError(400,'Transfer amount must exceed zero.');
 return {legalEntityId:le,fy,currency,fromCostCenterId,
  fromCategory:category(body.fromCategory),toCostCenterId,
  toCategory:category(body.toCategory),amountMinor:value,
  reason:clean(body.reason,500)};
}
async function validTransferAtApproval(ctx:OrgContext,transfer:BudgetTransfer,expectedPlanVersion:number){
 const p=await getDoc(planPath(ctx.orgId,transfer.legalEntityId,transfer.fy));
 if(!p)throw new HttpError(409,'Approved budget does not exist.');
 const plan=p.data as unknown as BudgetPlan;
 if(plan.version!==expectedPlanVersion)throw new HttpError(409,'Budget changed since proposal. Submit a new transfer request.');
 let next:BudgetPlan;
 try{next=applyApprovedTransfer(plan,transfer);}catch(e){throw new HttpError(409,(e as Error).message);}
 return {prior:p,next};
}
registerHandler('corp.budget.activate',{
 label:'Corporate approved budget plan',approvePerm:'FIN.setup.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const payload=getObject(req.payload),le=clean(req.leId,128),fy=integer(payload.fy);
  const {currency}=await yearCurrency(ctx,le,fy);
  if(currency!==clean(payload.currency,3))throw new HttpError(409,'Legal-entity currency has changed.');
  const {units}=await setup(ctx,le,'FIN.setup.approve');
  if(!Array.isArray(payload.lines))throw new HttpError(409,'Approved budget payload is missing.');
  const lines=validateNewPlan(payload.lines as BudgetLine[]);
  for(const line of lines)costCenterOf(line.costCenterId,le,units);
  const total=lines.reduce((n,l)=>n+l.approvedMinor,0);
  if(total!==Number(payload.totalMinor))throw new HttpError(409,'Proposal total is inconsistent.');
  const path=planPath(ctx.orgId,le,fy);
  const previous=await getDoc(path);
  if(previous)throw new HttpError(409,'An approved plan already exists. Use governed transfers or future budget revisions.');
  const plan:BudgetPlan={legalEntityId:le,fy,currency,lines,status:'approved',version:1,
   approvedBy:ctx.uid,approvedAt:nowIso(),approvalRef:id};
  if(!await writeDoc(path,plan as unknown as Fields,{exists:false}))
   throw new HttpError(409,'Approved budget already exists.');
  return {leId:le,fy,total:moneyNumber(total,currency),currency,version:1};
 },
});
registerHandler('corp.budget.revise',{
 label:'Annual budget revision / supplementary appropriation',
 approvePerm:'FIN.setup.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const payload=getObject(req.payload),revision=payload.revision as BudgetRevision;
  if(!revision||typeof revision!=='object')throw new HttpError(400,'Missing budget revision.');
  const {units}=await setup(ctx,revision.legalEntityId,'FIN.setup.approve');
  const {currency}=await yearCurrency(ctx,revision.legalEntityId,revision.fy);
  if(currency!==revision.currency)throw new HttpError(409,'Legal-entity currency has changed.');
  for(const change of revision.changes)
   costCenterOf(change.costCenterId,revision.legalEntityId,units);
  const path=planPath(ctx.orgId,revision.legalEntityId,revision.fy),prior=await getDoc(path);
  if(!prior)throw new HttpError(409,'Approved budget no longer exists.');
  const plan=prior.data as unknown as BudgetPlan;
  if(plan.version!==Number(payload.expectedPlanVersion))
   throw new HttpError(409,'Plan changed since the proposal. Submit an updated revision.');
  let next:BudgetPlan;
  try{next=applyApprovedRevision(plan,revision);}
  catch(e){throw new HttpError(409,(e as Error).message);}
  await commit([
   {path,fields:next as unknown as Obj,updateTime:prior.updateTime},
   {path:revisionPath(ctx.orgId,id),exists:false,fields:{
     ...revision,id,approvedBy:ctx.uid,proposedBy:clean(req.makerUid),
     approvedAt:nowIso(),approvalRef:id,status:'approved',
     priorVersion:plan.version,newVersion:next.version} as unknown as Obj},
  ]);
  return {fy:revision.fy,leId:revision.legalEntityId,version:next.version,currency,
    netBudgetChange:moneyNumber(revision.changes.reduce((n,c)=>n+c.deltaMinor,0),currency)};
 },
});
registerHandler('corp.budget.transfer',{
 label:'Internal budget allocation transfer',approvePerm:'FIN.cc.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const p=getObject(req.payload),transfer=p.transfer as BudgetTransfer;
  if(!transfer||typeof transfer!=='object')throw new HttpError(400,'Missing transfer.');
  const {units}=await setup(ctx,transfer.legalEntityId,'FIN.cc.approve');
  costCenterOf(transfer.fromCostCenterId,transfer.legalEntityId,units);
  costCenterOf(transfer.toCostCenterId,transfer.legalEntityId,units);
  const {currency}=await yearCurrency(ctx,transfer.legalEntityId,transfer.fy);
  if(currency!==transfer.currency)throw new HttpError(409,'Currency changed since proposal.');
  const {prior,next}=await validTransferAtApproval(ctx,transfer,Number(p.expectedPlanVersion));
  const at=nowIso();
  await commit([
   {path:planPath(ctx.orgId,transfer.legalEntityId,transfer.fy),fields:next as unknown as Obj,updateTime:prior.updateTime},
   {path:movePath(ctx.orgId,id),exists:false,fields:{...transfer,id,approvedBy:ctx.uid,
     proposedBy:clean(req.makerUid),approvalRef:id,approvedAt:at,status:'approved'} as unknown as Obj},
  ]);
  return {leId:transfer.legalEntityId,fy:transfer.fy,amount:moneyNumber(transfer.amountMinor,transfer.currency),
    currency:transfer.currency,budgetVersion:next.version};
 },
});
registerHandler('corp.budget.exception',{
 label:'Budget-exceedance exception',approvePerm:'FIN.post.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const p=getObject(req.payload);
  const le=clean(req.leId,128),fy=integer(p.fy),cc=clean(p.costCenterId,128),
   budgetCategory=category(p.category),currency=clean(p.currency,3);
  const {units}=await setup(ctx,le,'FIN.post.approve');
  costCenterOf(cc,le,units);
  const plan=await getPlan(ctx,le,fy);
  if(!plan||plan.currency!==currency||
    !plan.lines.some(l=>l.costCenterId===cc&&l.category===budgetCategory))
    throw new HttpError(409,'An approved budget line is required for an exception.');
  if(!validDate(clean(p.expiresOn,10))||clean(p.expiresOn,10)<today())
    throw new HttpError(409,'Budget exception expiry must not be in the past.');
  const maxExtraMinor=Number(p.maxExtraMinor);
  if(!Number.isSafeInteger(maxExtraMinor)||maxExtraMinor<=0)
    throw new HttpError(400,'Invalid exception amount.');
  const sourceDocumentId=clean(p.sourceDocumentId,128);
  if(!sourceDocumentId)throw new HttpError(400,'An exception must be tied to a source document.');
  const exception:BudgetException={id,legalEntityId:le,fy,costCenterId:cc,
   category:budgetCategory,currency,maxExtraMinor,sourceDocumentId,
   expiresOn:clean(p.expiresOn,10),reason:clean(req.reason,500),
   status:'approved',approvedBy:ctx.uid,approvedAt:nowIso(),approvalRef:id};
  if(!await writeDoc(exceptionPath(ctx.orgId,id),exception as unknown as Fields,{exists:false}))
   throw new HttpError(409,'Exception was already approved.');
  return {id,limit:moneyNumber(maxExtraMinor,currency),currency,sourceDocumentId,expiresOn:exception.expiresOn};
 },
});
registerHandler('corp.funding.agreement',{
 label:'Corporate funding policy agreement',approvePerm:'FIN.setup.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const p=getObject(req.payload),providerLegalEntityId=clean(req.leId,128);
  const beneficiaryLegalEntityId=clean(p.beneficiaryLegalEntityId,128);
  const {units}=await setup(ctx,providerLegalEntityId,'FIN.setup.approve');
  const beneficiary=units.get(beneficiaryLegalEntityId);
  if(!beneficiary||beneficiary.level!=='legal_entity'||beneficiary.status==='inactive')
    throw new HttpError(409,'Beneficiary legal entity no longer exists.');
  const agreement:FundingAgreement={
   id:clean(p.id,128),providerLegalEntityId,beneficiaryLegalEntityId,
   method:clean(p.method,15) as FundingMethod,currency:clean(p.currency,3),
   limitMinor:Number(p.limitMinor),agreementReference:clean(p.agreementReference,160),
   purpose:clean(p.purpose,500),effectiveFrom:clean(p.effectiveFrom,10),
   effectiveTo:clean(p.effectiveTo,10),budgetReference:clean(p.budgetReference,160),
   settlementPolicy:clean(p.settlementPolicy,30) as FundingAgreement['settlementPolicy'],
   status:providerLegalEntityId===beneficiaryLegalEntityId?'approved_policy':'awaiting_counterparty',
   approvalRef:id,confirmedApprovalRef:'',approvedBy:ctx.uid,confirmedBy:'',
   approvedAt:nowIso(),confirmedAt:'',
  };
  try{validateFundingAgreement(agreement);}catch(e){throw new HttpError(409,(e as Error).message);}
  if(!safeId(agreement.id))throw new HttpError(400,'Invalid agreement ID.');
  if(!await writeDoc(fundingPath(ctx.orgId,agreement.id),agreement as unknown as Fields,{exists:false}))
   throw new HttpError(409,'Funding agreement already exists.');
  return {agreementId:agreement.id,status:agreement.status,
    note:'Policy only. No money, loan, equity or journal entry was recorded.'};
 },
});
registerHandler('corp.funding.counterparty',{
 label:'Beneficiary funding policy confirmation',approvePerm:'FIN.setup.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const p=getObject(req.payload),agreementId=clean(p.agreementId,128);
  if(!safeId(agreementId))throw new HttpError(400,'Invalid agreement ID.');
  const path=fundingPath(ctx.orgId,agreementId),d=await getDoc(path);
  if(!d)throw new HttpError(404,'Funding agreement no longer exists.');
  const ag=d.data as unknown as FundingAgreement;
  if(ag.beneficiaryLegalEntityId!==clean(req.leId,128)||ag.status!=='awaiting_counterparty')
   throw new HttpError(409,'Funding agreement is not waiting for this entity.');
  await setup(ctx,ag.beneficiaryLegalEntityId,'FIN.setup.approve');
  const next:FundingAgreement={...ag,status:'approved_policy',confirmedApprovalRef:id,
   confirmedAt:nowIso(),confirmedBy:ctx.uid};
  if(!await writeDoc(path,next as unknown as Fields,{updateTime:d.updateTime}))
   throw new HttpError(409,'Funding agreement changed during confirmation.');
  return {agreementId,status:next.status,
   note:'Both legal entities approved the funding policy; no cash or GL posting was generated.'};
 },
});

const route=(name:string,fn:(ctx:OrgContext)=>Promise<unknown>)=>orgRoute(name,null,async ctx=>{
 await requireFinance(ctx);return fn(ctx);
});
export const corporateBudgetRoutes={
 'POST /api/org/corporate/budget/options':[route('org.corporate.budget.options',async ctx=>{
   const [units,scope]=await Promise.all([unitsOf(ctx.orgId),scopeOf(ctx)]);
   const entities=Array.from(units.values()).filter(u=>u.level==='legal_entity'&&
      ['FIN.view','FIN.setup.manage','FIN.cc.manage','FIN.post.approve'].some(p=>permAt(ctx,p,u.id,units,scope)));
   return {entities:entities.map(u=>({id:u.id,name:u.name,code:u.code})),
    classes:BUDGET_CLASSES,methods:FUNDING_METHODS,enforcement:'BLOCK_UNLESS_EXCEPTION_APPROVED',
    note:'Actual purchase/order budget enforcement is not yet connected in P2.'};
 })],
 'POST /api/org/corporate/budget/get':[route('org.corporate.budget.get',async ctx=>{
   const leId=clean(ctx.body.leId,128),fy=integer(ctx.body.fy);
   await setup(ctx,leId,'FIN.view');
   const [plan,financial,units]=await Promise.all([getPlan(ctx,leId,fy),entityOf(ctx.orgId,leId),unitsOf(ctx.orgId)]);
   const centres=Array.from(units.values()).filter(u=>u.level==='cost_center'&&u.status!=='inactive'&&leOf(units,u.id)?.id===leId)
    .map(c=>({id:c.id,name:c.name,code:c.code}));
   return {plan,currency:financial.functionalCurrency,centres,fy,
    note:'Budget preview and records are not a live procurement commitment gate.'};
 })],
 'POST /api/org/corporate/budget/propose':[route('org.corporate.budget.propose',async ctx=>{
   const leId=clean(ctx.body.leId,128),fy=integer(ctx.body.fy);
   const {units}=await setup(ctx,leId,'FIN.setup.manage');
   const {currency}=await yearCurrency(ctx,leId,fy);
   if(await getPlan(ctx,leId,fy))throw new HttpError(409,'Approved budget exists. Use controlled budget transfers.');
   const lines=verifyBudgetLines(ctx.body.lines,leId,currency,units);
   const totalMinor=lines.reduce((n,l)=>n+l.approvedMinor,0);
   if(!Number.isSafeInteger(totalMinor))throw new HttpError(400,'Budget total exceeds supported precision.');
   return createRequest(ctx,{leId,type:'corp.budget.activate',scopeKey:'corp.budget.'+leId+'.'+fy,
    title:'Budget plan FY'+fy,summary:lines.length+' lines; '+currency+' '+moneyNumber(totalMinor,currency),
    payload:{fy,currency,totalMinor,lines} as unknown as Obj,amount:moneyNumber(totalMinor,currency),
    reason:safeReason(ctx)});
 })],
 'POST /api/org/corporate/budget/revision/propose':[route('org.corporate.budget.revision.propose',async ctx=>{
   const leId=clean(ctx.body.leId,128),fy=integer(ctx.body.fy);
   const {units}=await setup(ctx,leId,'FIN.setup.manage');
   const plan=await getPlan(ctx,leId,fy);
   if(!plan)throw new HttpError(409,'Approve an opening annual budget before requesting revisions.');
   const raw=ctx.body.changes;
   if(!Array.isArray(raw)||!raw.length||raw.length>100)
    throw new HttpError(400,'Provide 1–100 revision lines.');
   const changes=raw.map(item=>{
    const x=getObject(item);
    const costCenterId=clean(x.costCenterId,128);costCenterOf(costCenterId,leId,units);
    const value=Number(x.delta);
    if(!Number.isFinite(value)||value===0)
     throw new HttpError(400,'Each revision delta must be nonzero.');
    return {costCenterId,category:category(x.category),
      deltaMinor:Math.sign(value)*amount(Math.abs(value),plan.currency)};
   });
   const reason=safeReason(ctx);
   const revision:BudgetRevision={legalEntityId:leId,fy,currency:plan.currency,changes,reason};
   try{applyApprovedRevision(plan,revision);}catch(e){throw new HttpError(400,(e as Error).message);}
   const requested=changes.reduce((sum,c)=>sum+Math.abs(c.deltaMinor),0);
   if(!Number.isSafeInteger(requested))throw new HttpError(400,'Revision total exceeds supported precision.');
   return createRequest(ctx,{leId,type:'corp.budget.revise',
    scopeKey:'corp.budget.revise.'+leId+'.'+fy,
    title:'Budget revision FY'+fy,summary:changes.length+' changes; '+plan.currency+
      ' '+moneyNumber(changes.reduce((sum,c)=>sum+c.deltaMinor,0),plan.currency)+' net amendment',
    payload:{revision,expectedPlanVersion:plan.version} as unknown as Obj,
    amount:moneyNumber(requested,plan.currency),reason});
 })],
 'POST /api/org/corporate/budget/transfer/propose':[route('org.corporate.budget.transfer.propose',async ctx=>{
   const leId=clean(ctx.body.leId,128),fy=integer(ctx.body.fy);
   const {units}=await setup(ctx,leId,'FIN.cc.manage');
   const plan=await getPlan(ctx,leId,fy);
   if(!plan)throw new HttpError(409,'An approved budget must exist before transfers.');
   const transfer=transferInput(ctx.body,leId,fy,plan.currency,units);
   let preview:BudgetPlan;
   try{preview=applyApprovedTransfer(plan,transfer);}catch(e){throw new HttpError(409,(e as Error).message);}
   void preview;
   return createRequest(ctx,{leId,type:'corp.budget.transfer',
    scopeKey:'corp.budget.transfer.'+leId+'.'+fy+'.'+transfer.fromCostCenterId+'.'+transfer.fromCategory,
    title:'Budget transfer FY'+fy,summary:transfer.fromCostCenterId+' '+transfer.fromCategory+
      ' → '+transfer.toCostCenterId+' '+transfer.toCategory+' '+plan.currency+' '+moneyNumber(transfer.amountMinor,transfer.currency),
    payload:{transfer,expectedPlanVersion:plan.version} as unknown as Obj,
    amount:moneyNumber(transfer.amountMinor,transfer.currency),reason:safeReason(ctx)});
 })],
 'POST /api/org/corporate/budget/exception/propose':[route('org.corporate.budget.exception.propose',async ctx=>{
   const leId=clean(ctx.body.leId,128),fy=integer(ctx.body.fy);
   const {units}=await setup(ctx,leId,'FIN.cc.manage');
   const plan=await getPlan(ctx,leId,fy);
   if(!plan)throw new HttpError(409,'An approved budget must exist before requesting an exception.');
   const cc=clean(ctx.body.costCenterId,128),cat=category(ctx.body.category);
   costCenterOf(cc,leId,units);
   if(!plan.lines.some(l=>l.costCenterId===cc&&l.category===cat))
    throw new HttpError(409,'Approved budget line not found.');
   const sourceDocumentId=clean(ctx.body.sourceDocumentId,128);
   const expiresOn=clean(ctx.body.expiresOn,10);
   if(!sourceDocumentId||!validDate(expiresOn)||expiresOn<today())
    throw new HttpError(400,'Source document and current or future expiry are required.');
   const maxExtraMinor=amount(ctx.body.amount,plan.currency);
   if(!maxExtraMinor)throw new HttpError(400,'Exception amount must exceed zero.');
   return createRequest(ctx,{leId,type:'corp.budget.exception',
    scopeKey:'corp.budget.exception.'+leId+'.'+fy+'.'+sourceDocumentId,
    title:'Over-budget exception '+sourceDocumentId,
    summary:cat+' '+cc+' '+plan.currency+' '+moneyNumber(maxExtraMinor,plan.currency)+' until '+expiresOn,
    payload:{fy,currency:plan.currency,costCenterId:cc,category:cat,
      sourceDocumentId,expiresOn,maxExtraMinor},amount:moneyNumber(maxExtraMinor,plan.currency),reason:safeReason(ctx)});
 })],
 'POST /api/org/corporate/budget/simulate':[route('org.corporate.budget.simulate',async ctx=>{
   const leId=clean(ctx.body.leId,128),fy=integer(ctx.body.fy);
   await setup(ctx,leId,'FIN.view');
   const cc=clean(ctx.body.costCenterId,128),cat=category(ctx.body.category);
   const plan=await getPlan(ctx,leId,fy);
   const calcCurrency=plan?.currency||(await entityOf(ctx.orgId,leId)).functionalCurrency;
   const requestedMinor=amount(ctx.body.amount,calcCurrency);
   const exceptionId=clean(ctx.body.exceptionId,128);
   const exp=exceptionId&&safeId(exceptionId)?await getDoc(exceptionPath(ctx.orgId,exceptionId)):null;
   const availability=checkBudget(plan,cc,cat,requestedMinor,
     exp?.data as unknown as BudgetException||null,today(),clean(ctx.body.sourceDocumentId,128));
   return {...availability,
    currency:plan?.currency||'',advisoryOnly:true,
    note:'Simulation only. Existing PR, PO, expense and payroll posting routes do not yet consume reservations or exceptions.'};
 })],
 'POST /api/org/corporate/funding/list':[route('org.corporate.funding.list',async ctx=>{
   const leId=clean(ctx.body.leId,128);
   await setup(ctx,leId,'FIN.view');
   const docs=await listDocs(root(ctx.orgId)+'/corp_funding_agreements');
   return {agreements:docs.map(d=>d.data).filter(d=>
      clean(d.providerLegalEntityId)===leId||clean(d.beneficiaryLegalEntityId)===leId).slice(0,500)};
 })],
 'POST /api/org/corporate/funding/propose':[route('org.corporate.funding.propose',async ctx=>{
   const leId=clean(ctx.body.providerLegalEntityId,128);
   const {units}=await setup(ctx,leId,'FIN.setup.manage');
   const beneficiaryLegalEntityId=clean(ctx.body.beneficiaryLegalEntityId,128);
   const beneficiary=units.get(beneficiaryLegalEntityId);
   if(!beneficiary||beneficiary.level!=='legal_entity'||beneficiary.status==='inactive')
    throw new HttpError(400,'Choose a registered and active beneficiary legal entity.');
   const ag:FundingAgreement={
    id:hashKey('corp.funding|'+leId+'|'+beneficiaryLegalEntityId+'|'+clean(ctx.body.agreementReference,160)),providerLegalEntityId:leId,beneficiaryLegalEntityId,
    method:clean(ctx.body.method,15) as FundingMethod,
    currency:clean(ctx.body.currency,3),limitMinor:amount(ctx.body.amount,clean(ctx.body.currency,3)),
    agreementReference:clean(ctx.body.agreementReference,160),
    purpose:clean(ctx.body.purpose,500),effectiveFrom:clean(ctx.body.effectiveFrom,10),
    effectiveTo:clean(ctx.body.effectiveTo,10),
    budgetReference:clean(ctx.body.budgetReference,160),
    settlementPolicy:clean(ctx.body.settlementPolicy,30) as FundingAgreement['settlementPolicy'],
    status:'awaiting_counterparty',approvalRef:'',confirmedApprovalRef:'',
    approvedBy:'',confirmedBy:'',approvedAt:'',confirmedAt:'',
   };
   try{validateFundingAgreement(ag);}catch(e){throw new HttpError(400,(e as Error).message);}
   if(!isFundingMethod(ag.method))throw new HttpError(400,'Unknown funding method.');
   if(await getDoc(fundingPath(ctx.orgId,ag.id)))throw new HttpError(409,'An approved agreement with this party and reference already exists.');
   return createRequest(ctx,{leId,type:'corp.funding.agreement',
    scopeKey:'corp.funding.agreement.'+leId+'.'+ag.agreementReference,
    title:'Funding agreement '+ag.agreementReference,summary:ag.method+' '+ag.currency+' '+
      moneyNumber(ag.limitMinor,ag.currency)+' to '+beneficiary.code,
    payload:ag as unknown as Obj,amount:moneyNumber(ag.limitMinor,ag.currency),reason:safeReason(ctx)});
 })],
 'POST /api/org/corporate/funding/counterparty/propose':[route('org.corporate.funding.counterparty.propose',async ctx=>{
   const agreementId=clean(ctx.body.agreementId,128);
   if(!safeId(agreementId))throw new HttpError(400,'Invalid agreement reference.');
   const d=await getDoc(fundingPath(ctx.orgId,agreementId));
   if(!d)throw new HttpError(404,'Agreement not found.');
   const ag=d.data as unknown as FundingAgreement;
   const leId=ag.beneficiaryLegalEntityId;
   await setup(ctx,leId,'FIN.setup.manage');
   if(ag.status!=='awaiting_counterparty')throw new HttpError(409,'Agreement no longer awaits beneficiary approval.');
   return createRequest(ctx,{leId,type:'corp.funding.counterparty',
     scopeKey:'corp.funding.counterparty.'+agreementId,title:'Accept funding terms '+ag.agreementReference,
     summary:ag.method+' '+ag.currency+' '+moneyNumber(ag.limitMinor,ag.currency)+' from '+ag.providerLegalEntityId,
     payload:{agreementId},amount:moneyNumber(ag.limitMinor,ag.currency),reason:safeReason(ctx)});
 })],
};
