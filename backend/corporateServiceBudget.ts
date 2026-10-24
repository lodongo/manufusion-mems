/**
 * P5 strict service-acceptance budget transition.
 * NO writes happen here: callers MUST include these CAS writes, the accepted PO
 * document, and the GL journal in the SAME Firestore commit.
 */
import {HttpError,getDoc} from './core';
import {type Write} from './finCore';
import {type BudgetPlan,type BudgetLine,budgetKey} from './corporateBudget';
import {commitmentRecordPath,planDocumentPath} from './corporateCommitmentPersistence';
import {type SourceCommitment} from './corporateCommitment';
export type AcceptedServiceCost={costCenterId:string;amountMinor:number};
export type ServiceActualChange={remainingMinor:number;actualMinor:number;status:'reserved'|'released';receiptId:string;writes:Write[]};
const lineOf=(plan:BudgetPlan,cc:string,category:string)=>
 plan.lines.find(l=>budgetKey(l.costCenterId,l.category)===cc+'|'+category);
export function recognizeServiceCost(
 plan:BudgetPlan,source:SourceCommitment,receiptId:string,
 accepted:readonly AcceptedServiceCost[],complete:boolean,
):{plan:BudgetPlan;source:SourceCommitment;actualMinor:number;remainingMinor:number}{
 if(!receiptId||!/^PO\d{8,9}(?:-V\d+)?_S\d+$/.test(receiptId))
  throw Error('Invalid service receipt id.');
 const booked=((source as SourceCommitment&{recognizedReceipts?:string[]}).recognizedReceipts)||[];
 if(booked.includes(receiptId))throw Error('Receipt has already consumed this source reservation.');
 if(source.status!=='reserved'||source.sourceKind!=='purchase_order')
  throw Error('Accepted service must correspond to an active PO reservation.');
 if(!accepted.length||accepted.length>200)throw Error('A receipt requires costed accepted service lines.');
 const outstanding=new Map(source.lines.map(l=>[budgetKey(l.costCenterId,l.category),{...l}]));
 const seen=new Map<string,number>();
 for(const x of accepted){
  if(!x.costCenterId||!Number.isSafeInteger(x.amountMinor)||x.amountMinor<=0)
   throw Error('Service cost must have an assigned cost centre and positive integer minor-unit amount.');
  const old=seen.get(x.costCenterId)||0;
  if(!Number.isSafeInteger(old+x.amountMinor))throw Error('Aggregated accepted amount exceeds supported precision.');
  seen.set(x.costCenterId,old+x.amountMinor);
 }
 const nextPlan:BudgetPlan={...plan,version:plan.version+1,lines:plan.lines.map(l=>({...l}))};
 let actualMinor=0;
 for(const [cc,amount] of seen){
  const matches=source.lines.filter(l=>l.costCenterId===cc);
  if(matches.length!==1)throw Error('Accepted cost centre must have exactly one matching PO reservation.');
  const prior=matches[0],key=budgetKey(cc,prior.category);
  if(prior.currency!==plan.currency||prior.legalEntityId!==plan.legalEntityId||prior.fy!==plan.fy)
   throw Error('Receipt legal entity, fiscal year or currency differs from reservation.');
  const row=lineOf(nextPlan,cc,prior.category);
  const remaining=outstanding.get(key);
  if(!row||!remaining||row.committedMinor<amount||remaining.amountMinor<amount)
   throw Error('Service acceptance is greater than its unconsumed budget reservation.');
  row.committedMinor-=amount;row.actualMinor+=amount;
  remaining.amountMinor-=amount;actualMinor+=amount;
  if(!Number.isSafeInteger(row.actualMinor)||!Number.isSafeInteger(actualMinor))
   throw Error('Budget actual exceeds integer precision.');
 }
 let remainingMinor=0;
 for(const reserved of outstanding.values()){
  const row=lineOf(nextPlan,reserved.costCenterId,reserved.category);
  if(!row)throw Error('Source budget class was removed while commitment was active.');
  if(complete){if(row.committedMinor<reserved.amountMinor)throw Error('Budget committed amount is inconsistent with PO remainder.');row.committedMinor-=reserved.amountMinor;}
  else remainingMinor+=reserved.amountMinor;
 }
 const newSource:SourceCommitment&{recognizedReceipts:string[]}={
  ...source,version:source.version+1,status:complete?'released':'reserved',
  lines:complete?[]:[...outstanding.values()].filter(x=>x.amountMinor>0),
  recognizedReceipts:[...booked,receiptId],
 };
 if(newSource.recognizedReceipts.length>60)throw Error('Too many accepted receipts for one PO.');
 if(!complete&&remainingMinor===0)throw Error('Receipt consumes all reservation but PO still has unfinished service quantities.');
 return {plan:nextPlan,source:newSource,actualMinor,remainingMinor};
}
export async function prepareServiceAcceptanceBudget(
 orgId:string,poBaseId:string,receiptId:string,
 accepted:readonly AcceptedServiceCost[],complete:boolean,
):Promise<ServiceActualChange>{
 const srcPath=commitmentRecordPath(orgId,'purchase_order',poBaseId),src=await getDoc(srcPath);
 if(!src||!src.updateTime)throw new HttpError(409,'Purchase order commitment is missing or cannot be safely updated.');
 const existing=src.data as unknown as SourceCommitment;
 if(existing.sourceDocumentId!==poBaseId||existing.sourceKey!==poBaseId)
  throw new HttpError(409,'Service commitment does not belong to the approved PO.');
 const heads=[...new Set(existing.lines.map(l=>l.legalEntityId+'|'+l.fy))];
 if(heads.length!==1)throw new HttpError(409,'Service budget pilot supports only one financial legal entity and year.');
 const original=existing.lines[0];
 if(!original)throw new HttpError(409,'Source reservation has no outstanding budget lines.');
 const path=planDocumentPath(orgId,original.legalEntityId,original.fy);
 const doc=await getDoc(path);
 if(!doc||!doc.updateTime)throw new HttpError(409,'Approved annual budget is missing or stale.');
 let result:ReturnType<typeof recognizeServiceCost>;
 try{result=recognizeServiceCost(doc.data as unknown as BudgetPlan,existing,receiptId,accepted,complete);}
 catch(e){throw new HttpError(409,(e as Error).message);}
 return {
  receiptId,status:result.source.status,
  actualMinor:result.actualMinor,remainingMinor:result.remainingMinor,
  writes:[
   {path,fields:result.plan as unknown as Write['fields'],updateTime:doc.updateTime},
   {path:srcPath,fields:result.source as unknown as Write['fields'],updateTime:src.updateTime},
  ],
 };
}
