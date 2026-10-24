/**
 * P2.5 atomic budget commitment planning primitive.
 * Used by a future PO/PR/WO mutation transaction; NOT an independent commit route.
 * The calling handler MUST write the source document and ALL returned plan/source
 * writes in the SAME Firestore atomic commit with updateTime preconditions.
 * No payroll/GL/cash activity is inferred from reservations.
 */
import {checkBudget,remainingMinor,type BudgetPlan,type BudgetException,type BudgetClass} from './corporateBudget';
export type CommitmentLine={
 legalEntityId:string;fy:number;currency:string;costCenterId:string;category:BudgetClass;amountMinor:number;
};
export type SourceCommitment={
 sourceKind:'purchase_order'|'purchase_requirement'|'work_order'|'other';
 sourceKey:string;sourceDocumentId:string;version:number;status:'reserved'|'released';
 lines:CommitmentLine[];
 exceptionIds:string[];
};
export type CommitmentTransition={
 plans:BudgetPlan[];
 source:SourceCommitment;
 changedPlans:string[];
 totalsMinor:Record<string,number>;
};
const lineId=(l:CommitmentLine)=>[
 l.legalEntityId,l.fy,l.currency,l.costCenterId,l.category,
].join('|');
const budgetId=(p:{legalEntityId:string;fy:number})=>p.legalEntityId+'|'+p.fy;
const validLines=(lines:CommitmentLine[])=>{
 if(lines.length>200)throw Error('Maximum 200 commitment lines per source event.');
 const seen=new Set<string>();
 for(const l of lines){
  if(!l.legalEntityId||!Number.isInteger(l.fy)||!l.currency||!l.costCenterId||!l.category||
    !Number.isSafeInteger(l.amountMinor)||l.amountMinor<=0)
   throw Error('Commitments require legal entity, fiscal year, currency, cost centre, class and a positive minor-unit amount.');
  const key=lineId(l);
  if(seen.has(key))throw Error('Duplicate commitment destination; consolidate source lines first.');
  seen.add(key);
 }
};
export function transitionCommitment(
 plans:readonly BudgetPlan[],
 prior:SourceCommitment|null,
 proposed:SourceCommitment,
 exceptions:readonly BudgetException[],
 at:string,
):CommitmentTransition{
 if(!proposed.sourceKey||!proposed.sourceDocumentId||!Number.isSafeInteger(proposed.version)||
  proposed.version<1)throw Error('Commitment must identify a versioned source document.');
 if(prior&&(prior.sourceKey!==proposed.sourceKey||
  prior.sourceDocumentId!==proposed.sourceDocumentId||
  prior.sourceKind!==proposed.sourceKind))throw Error('An existing commitment cannot be reassigned to another document.');
 if(prior&&proposed.version<prior.version)throw Error('Stale commitment version.');
 if(proposed.status!=='reserved'&&proposed.status!=='released')throw Error('Invalid reservation status.');
 if(proposed.status==='released'&&proposed.lines.length)throw Error('A released source cannot retain committed amounts.');
 validLines(proposed.lines);
 if(prior)validLines(prior.lines);
 const targetPlans=new Map(plans.map(p=>[budgetId(p),{
  ...p,lines:p.lines.map(l=>({...l})),
 }]));
 if(targetPlans.size!==plans.length)throw Error('Duplicate legal-entity/fiscal-year budget plans supplied.');
 // Remove prior reservations first. This makes amendments and cancellations delta-based,
 // rather than accumulating new full-value commitments on top of old PO versions.
 for(const l of prior?.lines||[]){
  const p=targetPlans.get(budgetId(l));
  if(!p||p.currency!==l.currency)throw Error('Original budget plan is absent or currency changed.');
  const row=p.lines.find(x=>x.costCenterId===l.costCenterId&&x.category===l.category);
  if(!row||row.committedMinor<l.amountMinor)
   throw Error('Previously reserved amount no longer matches approved budget records.');
  row.committedMinor-=l.amountMinor;
 }
 const knownExceptions=new Map(exceptions.filter(e=>e.status==='approved').map(e=>[e.id,e]));
 for(const l of proposed.lines){
  const p=targetPlans.get(budgetId(l));
  if(!p||p.status!=='approved'||p.currency!==l.currency)
   throw Error('No approved and currency-matched budget exists for the commitment.');
  const row=p.lines.find(x=>x.costCenterId===l.costCenterId&&x.category===l.category);
  if(!row)throw Error('Requested cost centre/category is absent from the approved budget.');
  const relevant=proposed.exceptionIds.map(id=>knownExceptions.get(id)).filter((e):e is BudgetException=>!!e);
  const matching=relevant.find(e=>e.legalEntityId===l.legalEntityId&&e.fy===l.fy&&
    e.currency===l.currency&&e.costCenterId===l.costCenterId&&e.category===l.category&&
    e.sourceDocumentId===proposed.sourceDocumentId);
  const availability=checkBudget(p,l.costCenterId,l.category,l.amountMinor,
    matching||null,at,proposed.sourceDocumentId);
  if(availability.status!=='within_budget')throw Error(
   'Budget blocked for '+lineId(l)+': remaining '+remainingMinor(row)+
   ' minor units, requested '+l.amountMinor+'. '+(matching?'Exception insufficient or expired.':'Obtain a source-specific Finance exception.'));
  row.committedMinor+=l.amountMinor;
 }
 const changedPlans:string[]=[];
 for(const original of plans){
  const updated=targetPlans.get(budgetId(original))!;
  if(updated.lines.some((l,i)=>l.committedMinor!==original.lines[i]?.committedMinor)){
   updated.version=original.version+1;
   changedPlans.push(budgetId(original));
  }
 }
 if(proposed.exceptionIds.some(id=>!knownExceptions.has(id)))
  throw Error('Exception reference is missing or not approved.');
 if(prior&&proposed.version===prior.version){
  const oldKey=JSON.stringify({status:prior.status,lines:prior.lines,exceptionIds:prior.exceptionIds});
  const newKey=JSON.stringify({status:proposed.status,lines:proposed.lines,exceptionIds:proposed.exceptionIds});
  if(oldKey!==newKey)throw Error('Changing commitment amounts requires a newer source version.');
 }
 const totalsMinor:Record<string,number>={};
 for(const l of proposed.lines)totalsMinor[budgetId(l)]=(totalsMinor[budgetId(l)]||0)+l.amountMinor;
 return {plans:Array.from(targetPlans.values()),source:proposed,changedPlans,totalsMinor};
}
