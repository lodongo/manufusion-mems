/** P6 execution of verified, approved shared cost allocations. */
import {HttpError,getDoc,str} from './core';
import {orgRoute,type OrgContext} from './guards';
import {createRequest,entityOf,permAt,registerHandler,requireFinance,scopeOf,unitsOf,reasonOf,type Obj} from './finCore';
import {majorFromMinor} from './corporateBudget';
import {allocationRunPath,executeVerifiedAllocation,previewVerifiedAllocation} from './corporateAllocationExecution';
import {icPostingEnabled} from './corporateIntercompanyPosting';
const clean=(v:unknown,n=128)=>str(v).trim().slice(0,n);
async function scoped(ctx:OrgContext,leId:string,perm:string){
 const [units,scope]=await Promise.all([unitsOf(ctx.orgId),scopeOf(ctx)]);
 const u=units.get(leId);
 if(!u||u.level!=='legal_entity'||u.status==='inactive')throw new HttpError(404,'Financial legal entity not found.');
 if(!permAt(ctx,perm,leId,units,scope))throw new HttpError(403,perm+' permission required in provider legal entity.');
}
registerHandler('corp.allocation.execute',{
 label:'Execute verified GL-backed corporate cost allocation',approvePerm:'FIN.post.approve',valued:true,
 apply:async(ctx,req,id)=>{
  const x=req.payload as Obj;
  const poolId=clean(x.policyId),source=clean(x.journalId),lineNo=Number(x.lineNo);
  const preview=await previewVerifiedAllocation(ctx.orgId,poolId,source,lineNo);
  await scoped(ctx,preview.policy.providerLegalEntityId,'FIN.post.approve');
  if(preview.policy.providerLegalEntityId!==clean(req.leId)||preview.source.amountMinor!==Number(x.sourceAmountMinor))
   throw new HttpError(409,'Signed allocation scope or source amount changed since proposal.');
  if(await getDoc(allocationRunPath(ctx.orgId,preview.runId)))throw new HttpError(409,'Source GL expense has already been allocated.');
  const outcome=await executeVerifiedAllocation(ctx,preview,id,clean(x.taxReviewReference,200),clean(req.makerUid));
  return {runId:outcome.id,voucherIds:outcome.voucherIds,sameEntityJournal:outcome.sameEntityJournalId,
   note:'Intra-entity GL reallocation posted atomically and cross-entity charge vouchers prepared for independent beneficiary matching; no cash settlement.'};
 },
});
export const corporateAllocationExecutionRoutes={
 'POST /api/org/corporate/allocation/verified-preview':[orgRoute('org.corporate.allocation.verified-preview','FIN.view',async ctx=>{
  const poolId=clean(ctx.body.policyId),journalId=clean(ctx.body.journalId),lineNo=Number(ctx.body.lineNo);
  const p=await previewVerifiedAllocation(ctx.orgId,poolId,journalId,lineNo);
  await scoped(ctx,p.policy.providerLegalEntityId,'FIN.view');
  const used=await getDoc(allocationRunPath(ctx.orgId,p.runId));
  return {poolCode:p.policy.code,runId:p.runId,currency:p.source.currency,source:p.source,
   allocation:p.allocation,previouslyExecuted:!!used,postingEnabled:icPostingEnabled(),
   note:'Verified posted P&L source. Fixed shares only. Approval creates internal reallocation and separate beneficiary vouchers, not an automatic bank transfer.'};
 })],
 'POST /api/org/corporate/allocation/execute/propose':[orgRoute('org.corporate.allocation.execute.propose','FIN.close.run',async ctx=>{
  const poolId=clean(ctx.body.policyId),journalId=clean(ctx.body.journalId),lineNo=Number(ctx.body.lineNo);
  const preview=await previewVerifiedAllocation(ctx.orgId,poolId,journalId,lineNo);
  await scoped(ctx,preview.policy.providerLegalEntityId,'FIN.close.run');
  if(!icPostingEnabled())throw new HttpError(409,'P6 allocation execution is not enabled for this isolated development environment.');
  if(await getDoc(allocationRunPath(ctx.orgId,preview.runId)))throw new HttpError(409,'This GL expense line was already allocated.');
  const taxReviewReference=clean(ctx.body.taxReviewReference,200);
  if(taxReviewReference.length<6)throw new HttpError(400,'Approved tax treatment evidence is required before proposing a cross-entity allocation.');
  const reason=reasonOf(ctx.body);
  return createRequest(ctx,{leId:preview.policy.providerLegalEntityId,type:'corp.allocation.execute',
   title:'Execute verified group allocation '+preview.policy.code,
   summary:'Posted GL '+preview.source.journalId+' line '+lineNo+'; '+preview.source.currency+' '+
    majorFromMinor(preview.source.amountMinor,preview.source.currency)+'; source CC '+preview.source.ccId,
   scopeKey:'p6.allocation.exec.'+preview.runId,
   payload:{policyId:poolId,journalId,lineNo,sourceAmountMinor:preview.source.amountMinor,taxReviewReference},
   reason,amount:majorFromMinor(preview.source.amountMinor,preview.source.currency)});
 })],
};
