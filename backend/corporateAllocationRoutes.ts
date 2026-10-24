/**
 * Shared-cost policy lifecycle under existing Finance maker/checker and entity authority.
 * No GL/invoice/cash posting. Allocation preview is advisory, using explicit measured drivers.
 */
import {HttpError,getDoc,listDocs,nowIso,randomId,str,writeDoc,type Fields} from './core';
import {orgRoute,type OrgContext} from './guards';
import {
  chartOf,createRequest,entityOf,leOf,needEntity,permAt,reasonOf,registerHandler,
  scopeOf,unitsOf,
  type Unit,type Obj,
} from './finCore';
import {moneyMinor,majorFromMinor,minorFactor} from './corporateBudget';
import {
  ALLOCATION_BASIS,POOL_TYPES,validateAllocationPolicy,calculateAllocation,pendingCounterparties,
  allocationIsEffective,
  type AllocationReferences,type AllocationPolicy,type AllocationBeneficiary,
  type AllocationBasis,type CostNature,
} from './corporateAllocation';
const root=(org:string)=>'organizations/'+org+'/corp_allocation_policies';
const path=(org:string,id:string)=>root(org)+'/'+id;
const clean=(x:unknown,max=200)=>str(x).trim().slice(0,max);
const refOK=(x:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(x);
const rec=(x:unknown):Record<string,unknown>=>{
 if(!x||typeof x!=='object'||Array.isArray(x))throw new HttpError(400,'Expected configuration object.');
 return x as Record<string,unknown>;
};
const obj=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
async function scoped(ctx:OrgContext,leId:string,permission:string){
 const [units,scope]=await Promise.all([unitsOf(ctx.orgId),scopeOf(ctx)]);
 const le=needEntity(units,scope,leId);
 if(!permAt(ctx,permission,le.id,units,scope))
  throw new HttpError(403,permission+' required for '+le.code+'.');
 return {units,le};
}
async function scopedReader(ctx:OrgContext,leId:string){
 const {units,le}=await scoped(ctx,leId,'FIN.view').catch(async e=>{
  if(!(e instanceof HttpError)||e.status!==403)throw e;
  const [nodes,scope]=await Promise.all([unitsOf(ctx.orgId),scopeOf(ctx)]);
  const legal=needEntity(nodes,scope,leId);
  if(!['FIN.setup.manage','FIN.cc.manage','FIN.setup.approve','FIN.post.approve'].some(p=>
     permAt(ctx,p,legal.id,nodes,scope)))throw e;
  return {units:nodes,le:legal};
 });
 return {units,le};
}
async function refs(ctx:OrgContext):Promise<AllocationReferences>{
 const [units,corporate]=await Promise.all([unitsOf(ctx.orgId),
   getDoc('organizations/'+ctx.orgId+'/corporate_governance/default')]);
 const legalEntities=Array.from(units.values()).filter(u=>u.level==='legal_entity'&&u.status!=='inactive')
   .map(u=>({id:u.id,name:u.name,code:u.code}));
 const costCenters=Array.from(units.values()).filter(u=>u.level==='cost_center'&&u.status!=='inactive')
   .flatMap(u=>{const le=leOf(units,u.id);return le&&le.status!=='inactive'?
    [{id:u.id,name:u.name,code:u.code,legalEntityId:le.id}]:[];});
 const functions=Array.isArray(corporate?.data.functions)?corporate.data.functions.map(x=>obj(x))
  .filter(x=>x.enabled!==false&&clean(x.code,30)).map(x=>({code:clean(x.code,30),name:clean(x.name)})):[];
 return {legalEntities,costCenters,functions};
}
async function checkedPolicy(ctx:OrgContext,p:AllocationPolicy){
 const references=await refs(ctx);
 try{validateAllocationPolicy(p,references);}catch(e){throw new HttpError(400,(e as Error).message);}
 const provider=await entityOf(ctx.orgId,p.providerLegalEntityId);
 if(provider.functionalCurrency!==p.currency)
  throw new HttpError(409,'Allocation pool currency must match the provider legal entity functional currency.');
 if(p.glAccountCodes.length){
  const chart=await chartOf(ctx.orgId,p.providerLegalEntityId);
  for(const code of p.glAccountCodes){
   const a=chart.get(code);
   if(!a||a.status!=='active'||!a.postable||a.statement!=='PL')
    throw new HttpError(409,'GL source account '+code+' must be an active P&L account in the provider legal entity.');
  }
 }
 return p;
}
function parsePolicy(ctx:OrgContext,raw:unknown,leId:string,currency:string):AllocationPolicy{
 const x=rec(raw),bs=x.beneficiaries;
 if(!Array.isArray(bs)||bs.length>100)throw new HttpError(400,'Configure beneficiary cost centres.');
 const beneficiaries:AllocationBeneficiary[]=bs.map(value=>{
  const b=rec(value);
  return {
   legalEntityId:clean(b.legalEntityId,128),costCenterId:clean(b.costCenterId,128),
   fixedPercent:Number(b.fixedPercent),serviceAgreementRef:clean(b.serviceAgreementRef,160),
   benefitEvidence:clean(b.benefitEvidence,500),
  };
 });
 const annualCeiling=Number(x.annualCeiling);
 let annualCeilingMinor:number;
 try{annualCeilingMinor=moneyMinor(annualCeiling,currency)}
 catch(e){throw new HttpError(400,(e as Error).message);}
 return {
  id:randomId(12),code:clean(x.code,30).toUpperCase(),name:clean(x.name,130),
  providerLegalEntityId:leId,sourceCostCenterId:clean(x.sourceCostCenterId,128),
  functionCode:clean(x.functionCode,30),costNature:clean(x.costNature,30) as CostNature,
  basis:clean(x.basis,30) as AllocationBasis,beneficiaries,
  glAccountCodes:Array.isArray(x.glAccountCodes)?x.glAccountCodes.map(g=>clean(g,60)):[],
  currency,annualCeilingMinor,effectiveFrom:clean(x.effectiveFrom,10),
  effectiveTo:clean(x.effectiveTo,10),purpose:clean(x.purpose,500),
  driverEvidencePolicy:clean(x.driverEvidencePolicy,500),
  taxPolicyReference:clean(x.taxPolicyReference,300),
  pricingPolicy:clean(x.pricingPolicy,20) as AllocationPolicy['pricingPolicy'],
  status:'awaiting_counterparties',version:1,approvalRef:'',approvedBy:'',approvedAt:'',confirmations:{},
 };
}
registerHandler('corp.allocation.approve',{
 label:'Shared cost allocation policy',approvePerm:'FIN.setup.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const p=rec(req.payload).policy as AllocationPolicy;
  if(!p||p.providerLegalEntityId!==clean(req.leId,128)||!refOK(p.id))
   throw new HttpError(409,'Allocation policy proposal is no longer valid.');
  await scoped(ctx,p.providerLegalEntityId,'FIN.setup.approve');
  await checkedPolicy(ctx,p);
  // One active policy identifier per project; code reuse requires a separate end-dating migration.
  const existing=await listDocs(root(ctx.orgId));
  if(existing.some(d=>clean(d.data.code)===p.code))
   throw new HttpError(409,'A policy with this code already exists. End-date it before proposing a replacement.');
  const at=nowIso();
  const confirmed:AllocationPolicy={...p,approvalRef:id,approvedBy:ctx.uid,approvedAt:at,
   status:pendingCounterparties(p).length?'awaiting_counterparties':'approved_policy'};
  if(!await writeDoc(path(ctx.orgId,p.id),confirmed as unknown as Fields,{exists:false}))
   throw new HttpError(409,'Allocation policy already exists.');
  return {policyId:p.id,status:confirmed.status,pendingCounterparties:pendingCounterparties(confirmed),
   note:'Policy approved. No GL, intercompany invoice or cash movement occurred.'};
 },
});
registerHandler('corp.allocation.counterparty',{
 label:'Beneficiary shared cost allocation agreement',approvePerm:'FIN.setup.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const policyId=clean(rec(req.payload).policyId,128);
  if(!refOK(policyId))throw new HttpError(400,'Invalid policy reference.');
  const pth=path(ctx.orgId,policyId),doc=await getDoc(pth);
  if(!doc)throw new HttpError(404,'Allocation policy not found.');
  const p=doc.data as unknown as AllocationPolicy,leId=clean(req.leId,128);
  await scoped(ctx,leId,'FIN.setup.approve');
  if(!pendingCounterparties(p).includes(leId))
   throw new HttpError(409,'This beneficiary legal entity has already confirmed or is not included.');
  if(ctx.uid===p.approvedBy||Object.values(p.confirmations).some(c=>c.approvedBy===ctx.uid))
   throw new HttpError(403,'The provider approver or another entity approver cannot approve this beneficiary confirmation.');
  await checkedPolicy(ctx,p);
  const confirmations={...p.confirmations,[leId]:{approvedBy:ctx.uid,approvedAt:nowIso(),approvalRef:id}};
  const next:AllocationPolicy={...p,confirmations,version:p.version+1};
  next.status=pendingCounterparties(next).length?'awaiting_counterparties':'approved_policy';
  if(!await writeDoc(pth,next as unknown as Fields,{updateTime:doc.updateTime}))
   throw new HttpError(409,'Policy changed while approving beneficiary. Retry.');
  return {policyId,status:next.status,remaining:pendingCounterparties(next)};
 },
});
export const corporateAllocationRoutes={
 'POST /api/org/corporate/allocation/options':[orgRoute('org.corporate.allocation.options','FIN.view',async ctx=>{
  const r=await refs(ctx),{units}=await scopedAll(ctx);
  const scope=await scopeOf(ctx);
  return {...r,allLegalEntities:r.legalEntities,legalEntities:r.legalEntities.filter(l=>
   ['FIN.view','FIN.setup.manage','FIN.cc.manage','FIN.setup.approve'].some(perm=>permAt(ctx,perm,l.id,units,scope))),
   // Only structural destinations, not financial amounts, are exposed here.
   // A corporate Finance policy owner needs to select beneficiary cost centres in other entities.
   costCenters:r.costCenters,
   basis:ALLOCATION_BASIS,costNature:POOL_TYPES};
 })],
 'POST /api/org/corporate/allocation/list':[orgRoute('org.corporate.allocation.list','FIN.view',async ctx=>{
  const leId=clean(ctx.body.legalEntityId,128);
  await scopedReader(ctx,leId);
  const policies=await listDocs(root(ctx.orgId));
  return {policies:policies.filter(d=>clean(d.data.providerLegalEntityId)===leId).map(d=>d.data)};
 })],
 'POST /api/org/corporate/allocation/beneficiary/list':[orgRoute('org.corporate.allocation.beneficiary.list','FIN.setup.manage',async ctx=>{
  const leId=clean(ctx.body.legalEntityId,128);
  await scoped(ctx,leId,'FIN.setup.manage');
  const docs=await listDocs(root(ctx.orgId));
  const policies=docs.filter(d=>Array.isArray(d.data.beneficiaries)&&
    d.data.beneficiaries.some((b:unknown)=>clean(obj(b).legalEntityId,128)===leId)&&
    clean(d.data.providerLegalEntityId)!==leId)
   .map(d=>({
    id:d.id,code:clean(d.data.code),name:clean(d.data.name),providerLegalEntityId:clean(d.data.providerLegalEntityId),
    currency:clean(d.data.currency),annualCeilingMinor:Number(d.data.annualCeilingMinor),
    status:clean(d.data.status),basis:clean(d.data.basis),
    beneficiaries:(d.data.beneficiaries as unknown[]).filter(b=>clean(obj(b).legalEntityId,128)===leId),
    confirmed:!!obj(d.data.confirmations)[leId],
   }));
  return {policies};
 })],
 'POST /api/org/corporate/allocation/propose':[orgRoute('org.corporate.allocation.propose','FIN.setup.manage',async ctx=>{
  const leId=clean(ctx.body.providerLegalEntityId,128);
  await scoped(ctx,leId,'FIN.setup.manage');
  const finance=await entityOf(ctx.orgId,leId);
  if(!finance.functionalCurrency)throw new HttpError(409,'Configure provider legal-entity finance first.');
  const policy=parsePolicy(ctx,ctx.body.policy,leId,finance.functionalCurrency);
  await checkedPolicy(ctx,policy);
  const prior=await listDocs(root(ctx.orgId));
  if(prior.some(d=>clean(d.data.code)===policy.code))
   throw new HttpError(409,'Allocation policy code is already in use.');
  return createRequest(ctx,{leId,type:'corp.allocation.approve',
   scopeKey:'corp.allocation.code.'+leId+'.'+policy.code,
   title:'Approve allocation pool '+policy.code,
   summary:policy.name+'; '+policy.basis+'; '+policy.currency+' '+majorFromMinor(policy.annualCeilingMinor,policy.currency),
   payload:{policy} as unknown as Obj,amount:majorFromMinor(policy.annualCeilingMinor,policy.currency),
   reason:reasonOf(ctx.body)});
 })],
 'POST /api/org/corporate/allocation/beneficiary/propose':[orgRoute('org.corporate.allocation.beneficiary.propose','FIN.setup.manage',async ctx=>{
  const policyId=clean(ctx.body.policyId,128);
  if(!refOK(policyId))throw new HttpError(400,'Invalid allocation policy ID.');
  const doc=await getDoc(path(ctx.orgId,policyId));
  if(!doc)throw new HttpError(404,'Allocation policy was not found.');
  const p=doc.data as unknown as AllocationPolicy,leId=clean(ctx.body.legalEntityId,128);
  await scoped(ctx,leId,'FIN.setup.manage');
  if(!pendingCounterparties(p).includes(leId))
   throw new HttpError(409,'Policy does not require this legal entity to confirm.');
  const fin=await entityOf(ctx.orgId,leId);
  // Cross-currency agreement approved under beneficiary's CoA at conservative rounded-up value.
  const rate=p.currency===fin.functionalCurrency?1:await (await import('./finCore')).fxRate(p.currency,fin.functionalCurrency);
  const base=majorFromMinor(p.annualCeilingMinor,p.currency)*rate;
  const approvalAmount=Math.ceil(base*minorFactor(fin.functionalCurrency))/minorFactor(fin.functionalCurrency);
  return createRequest(ctx,{leId,type:'corp.allocation.counterparty',
   scopeKey:'corp.allocation.accept.'+policyId+'.'+leId,
   title:'Accept allocation pool '+p.code,summary:p.name+' from '+p.providerLegalEntityId+
    '; ceiling '+p.currency+' '+majorFromMinor(p.annualCeilingMinor,p.currency),
   payload:{policyId,approvalFxRate:rate,approvalCurrency:fin.functionalCurrency} as unknown as Obj,
   amount:approvalAmount,reason:reasonOf(ctx.body)});
 })],
 'POST /api/org/corporate/allocation/preview':[orgRoute('org.corporate.allocation.preview','FIN.view',async ctx=>{
  const policyId=clean(ctx.body.policyId,128);
  if(!refOK(policyId))throw new HttpError(400,'Invalid allocation policy ID.');
  const doc=await getDoc(path(ctx.orgId,policyId));
  if(!doc)throw new HttpError(404,'Allocation policy not found.');
  const policy=doc.data as unknown as AllocationPolicy;
  await scopedReader(ctx,policy.providerLegalEntityId);
  const cost=Number(ctx.body.cost);
  let minor:number;
  try{minor=moneyMinor(cost,policy.currency)}
  catch(e){throw new HttpError(400,(e as Error).message);}
  const drivers=rec(ctx.body.drivers||{});
  const values:Record<string,number>={};
  for(const [key,value] of Object.entries(drivers)){
   if(!/^[A-Za-z0-9_-]{1,128}\|[A-Za-z0-9_-]{1,128}$/.test(key))throw new HttpError(400,'Invalid driver key.');
   values[key]=Number(value);
  }
  await checkedPolicy(ctx,policy);
  let output;
  try{output=calculateAllocation(policy,minor,values);}catch(e){throw new HttpError(400,(e as Error).message);}
  return {...output,currency:policy.currency,policyEffective:allocationIsEffective(policy,clean(ctx.body.date,10)||new Date().toISOString().slice(0,10)),
   policyStatus:policy.status,advisoryOnly:true,
   note:'Preview based on supplied values, NOT verified period source ledger or driver evidence. No GL, invoice, intercompany balance, cost reallocation, commitment or cash transfer occurred.'};
 })],
};
async function scopedAll(ctx:OrgContext){return {units:await unitsOf(ctx.orgId)};}
