/**
 * Budget commitment persistence adapter (P2.5).
 * Produces Firestore CAS writes to include in the CALLER'S source-document commit.
 * This function does NOT commit; it must never be called as an independent
 * "reserve" step alongside purchase order approval.
 */
import {HttpError,getDoc,type Doc} from './core';
import {hashKey,type Write} from './finCore';
import {type BudgetPlan,type BudgetException} from './corporateBudget';
import {
 transitionCommitment,type SourceCommitment,type CommitmentTransition,
} from './corporateCommitment';

const base=(orgId:string)=>'organizations/'+orgId;
export const commitmentRecordPath=(orgId:string,sourceKind:string,sourceKey:string)=>
 base(orgId)+'/corp_budget_commitments/'+hashKey(sourceKind+'|'+sourceKey);
export const planDocumentPath=(orgId:string,legalEntityId:string,fy:number)=>
 base(orgId)+'/corp_budgets/'+legalEntityId+'_'+fy;
export const exceptionDocumentPath=(orgId:string,id:string)=>
 base(orgId)+'/corp_budget_exceptions/'+id;
export type PreparedCommitment={
 source:SourceCommitment;
 transition:CommitmentTransition;
 writes:Write[];
 budgetSnapshots:Array<{path:string;updateTime:string}>;
 sourceSnapshot:string|null;
};
/** The caller must add its PO/WO/PR source-document update to this SAME write batch. */
export async function prepareCommitmentWrites(
 orgId:string,proposed:SourceCommitment,at:string,
):Promise<PreparedCommitment>{
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(orgId))
  throw new HttpError(400,'Invalid tenant for budget commitment.');
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(proposed.sourceKey)||
    !/^[A-Za-z0-9_-]{1,128}$/.test(proposed.sourceDocumentId))
  throw new HttpError(400,'Source document reference is not a valid budget key.');
 if(proposed.exceptionIds.length>100||new Set(proposed.exceptionIds).size!==proposed.exceptionIds.length||
    proposed.exceptionIds.some(x=>!/^[A-Za-z0-9_-]{1,128}$/.test(x)))
  throw new HttpError(400,'Invalid or duplicate exception references.');
 const recordPath=commitmentRecordPath(orgId,proposed.sourceKind,proposed.sourceKey);
 const priorDoc=await getDoc(recordPath);
 const prior=priorDoc?priorDoc.data as unknown as SourceCommitment:null;
 const keys=new Set([...proposed.lines,...(prior?.lines||[])].map(x=>x.legalEntityId+'|'+x.fy));
 if(keys.size>100)throw new HttpError(400,'Maximum 100 financial-year budgets per source transaction.');
 const docs=await Promise.all([...keys].map(async k=>{
  const [leId,rawFy]=k.split('|'),fy=Number(rawFy);
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(leId)||!Number.isSafeInteger(fy)||fy<1900||fy>2500)
   throw new HttpError(400,'Invalid legal entity or financial year in source lines.');
  const path=planDocumentPath(orgId,leId,fy);
  const doc=await getDoc(path);
  if(!doc)throw new HttpError(409,'Approved budget is missing for '+leId+' FY'+fy+'.');
  return {path,doc};
 }));
 const exceptions=await Promise.all(proposed.exceptionIds.map(async id=>{
  const d=await getDoc(exceptionDocumentPath(orgId,id));
  if(!d)throw new HttpError(409,'Budget exception '+id+' no longer exists.');
  return d.data as unknown as BudgetException;
 }));
 let transition:CommitmentTransition;
 try{
  transition=transitionCommitment(docs.map(x=>x.doc.data as unknown as BudgetPlan),prior,proposed,exceptions,at);
 }catch(e){throw new HttpError(409,e instanceof Error?e.message:'Budget commitment is unavailable.');}
 // Ensure zero-side-effect CAS semantics. A later source-document update MUST be in the batch.
 const changed=new Set(transition.changedPlans);
 const writes:Write[]=docs.flatMap(({path,doc})=>{
  const plan=transition.plans.find(x=>planDocumentPath(orgId,x.legalEntityId,x.fy)===path);
  if(!plan||!changed.has(plan.legalEntityId+'|'+plan.fy))return [];
  if(!doc.updateTime)throw new HttpError(409,'Budget snapshot has no update timestamp.');
  return [{path,fields:plan as unknown as Record<string,unknown> as Write['fields'],updateTime:doc.updateTime}];
 });
 // Always touch the source record when a new version is processed, even if net commitment = 0.
 // Source-document writes cannot be made independently of this record.
 const unchanged=prior&&JSON.stringify(prior)===JSON.stringify(proposed);
 if(!unchanged){
  const entry:Write={path:recordPath,fields:proposed as unknown as Write['fields']};
  if(priorDoc){
   if(!priorDoc.updateTime)throw new HttpError(409,'Commitment snapshot timestamp unavailable.');
   entry.updateTime=priorDoc.updateTime;
  }else entry.exists=false;
  writes.push(entry);
 }
 return {
  source:proposed,transition,writes,
  budgetSnapshots:docs.map(x=>({path:x.path,updateTime:x.doc.updateTime})),
  sourceSnapshot:priorDoc?.updateTime||null,
 };
}
