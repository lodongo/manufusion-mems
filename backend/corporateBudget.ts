/**
 * P2 corporate budget and funding policy primitives.
 * Amounts are integers in the smallest currency unit; NO GL journal is generated.
 * All exported evaluators are pure, allowing governance tests without Firestore.
 */
export const BUDGET_CLASSES=[
 {code:'OPEX',label:'Operating expenditure'},
 {code:'CAPEX',label:'Capital expenditure'},
 {code:'PAYROLL',label:'Payroll and employee benefits'},
 {code:'PROJECT',label:'Projects and investment programmes'},
 {code:'SHARED',label:'Shared-service charges'},
 {code:'OTHER',label:'Other approved budget'},
] as const;
export const FUNDING_METHODS=[
 {code:'COR',label:'Central / corporate appropriation'},
 {code:'ENT',label:'Legal-entity self-funding'},
 {code:'REI',label:'Cost reimbursement / shared service funding'},
 {code:'LOAN',label:'Intercompany loan'},
 {code:'EQU',label:'Capital contribution'},
 {code:'CPOOL',label:'Cash pooling / treasury advance'},
 {code:'HYB',label:'Hybrid / agreement-defined'},
] as const;
export type BudgetClass=typeof BUDGET_CLASSES[number]['code'];
export type FundingMethod=typeof FUNDING_METHODS[number]['code'];
export type BudgetLine={
 costCenterId:string;category:BudgetClass;approvedMinor:number;
 adjustmentsMinor:number;committedMinor:number;actualMinor:number;
};
export type BudgetPlan={
 legalEntityId:string;fy:number;currency:string;lines:BudgetLine[];
 status:'approved';version:number;approvedBy:string;approvedAt:string;approvalRef:string;
};
export type BudgetTransfer={
 legalEntityId:string;fy:number;currency:string;
 fromCostCenterId:string;fromCategory:BudgetClass;
 toCostCenterId:string;toCategory:BudgetClass;
 amountMinor:number;reason:string;
};
export type BudgetException={
 id:string;legalEntityId:string;fy:number;costCenterId:string;
 category:BudgetClass;maxExtraMinor:number;currency:string;
 sourceDocumentId:string;expiresOn:string;reason:string;status:'approved';
 approvedAt:string;approvedBy:string;approvalRef:string;
};
export type FundingAgreement={
 id:string;providerLegalEntityId:string;beneficiaryLegalEntityId:string;
 method:FundingMethod;currency:string;limitMinor:number;
 agreementReference:string;purpose:string;effectiveFrom:string;effectiveTo:string;
 budgetReference:string;settlementPolicy:'IMMEDIATE'|'MONTHLY'|'QUARTERLY'|'ON_DEMAND'|'PER_AGREEMENT';
 status:'awaiting_counterparty'|'approved_policy';approvalRef:string;confirmedApprovalRef:string;
 approvedBy:string;confirmedBy:string;approvedAt:string;confirmedAt:string;
};
export type BudgetAvailability={
 status:'within_budget'|'requires_exception'|'no_approved_budget';
 totalMinor:number;committedMinor:number;actualMinor:number;availableMinor:number;
 shortfallMinor:number;exceptionUsable:boolean;
};
/** ISO 4217 currency minor-unit exponent from Node/browser ICU data. */
export function currencyDigits(currency:string):number{
 if(!/^[A-Z]{3}$/.test(currency))throw Error('Choose a valid ISO 4217 currency.');
 try{
  const d=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
  if(typeof d!=='number'||!Number.isInteger(d)||d<0||d>4)throw Error('Unsupported currency exponent.');
  return d;
 }catch{throw Error('Currency code is unsupported by the active ISO 4217 runtime.');}
}
export const minorFactor=(currency:string)=>10**currencyDigits(currency);
export const majorFromMinor=(minor:number,currency:string)=>minor/minorFactor(currency);
export const moneyMinor=(value:unknown,currency:string)=>{
 const factor=minorFactor(currency);
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||
   !Number.isSafeInteger(Math.round(value*factor))||
   Math.abs(value*factor-Math.round(value*factor))>1e-6)
   throw Error('Amount must be nonnegative and respect '+currencyDigits(currency)+' minor-currency decimal places.');
 return Math.round(value*factor);
};
export const isBudgetClass=(x:string):x is BudgetClass=>BUDGET_CLASSES.some(k=>k.code===x);
export const isFundingMethod=(x:string):x is FundingMethod=>FUNDING_METHODS.some(k=>k.code===x);
export const budgetKey=(cc:string,category:BudgetClass)=>cc+'|'+category;
export function remainingMinor(line:BudgetLine):number {
 return line.approvedMinor+line.adjustmentsMinor-line.committedMinor-line.actualMinor;
}
export function validateNewPlan(lines:readonly BudgetLine[]):BudgetLine[]{
 if(!lines.length||lines.length>200)throw Error('The budget needs 1–200 cost-centre/category lines.');
 const keys=new Set<string>();
 return lines.map(row=>{
  if(!row.costCenterId||!isBudgetClass(row.category))
   throw Error('Every budget line needs a cost centre and approved budget class.');
  const key=budgetKey(row.costCenterId,row.category);
  if(keys.has(key))throw Error('Duplicate cost-centre/category budget line.');
  keys.add(key);
  if(!Number.isSafeInteger(row.approvedMinor)||row.approvedMinor<=0)
   throw Error('Approved budget lines must be positive whole minor-currency amounts.');
  if(row.adjustmentsMinor!==0||row.actualMinor!==0||row.committedMinor!==0)
   throw Error('Opening budgets may not import unapproved adjustments, commitments or actual costs.');
  return {...row};
 });
}
export type BudgetRevision={
 legalEntityId:string;fy:number;currency:string;
 changes:Array<{costCenterId:string;category:BudgetClass;deltaMinor:number}>;
 reason:string;
};
/** Governed appropriation revisions are budget-only. They do not move cash or post GL. */
export function applyApprovedRevision(plan:BudgetPlan,revision:BudgetRevision):BudgetPlan{
 if(plan.status!=='approved'||plan.legalEntityId!==revision.legalEntityId||
    plan.fy!==revision.fy||plan.currency!==revision.currency)
   throw Error('Revision must match the approved legal entity, currency and fiscal year.');
 if(!revision.changes.length||revision.changes.length>100)
   throw Error('A budget revision needs 1–100 change lines.');
 const keys=new Set<string>();
 const nextLines=plan.lines.map(l=>({...l}));
 for(const c of revision.changes){
  if(!c.costCenterId||!isBudgetClass(c.category)||!Number.isSafeInteger(c.deltaMinor)||!c.deltaMinor)
   throw Error('Revision lines must have a cost centre, category and nonzero whole-unit change.');
  const key=budgetKey(c.costCenterId,c.category);
  if(keys.has(key))throw Error('Duplicate revision line.');keys.add(key);
  let line=nextLines.find(x=>budgetKey(x.costCenterId,x.category)===key);
  if(!line){
   if(c.deltaMinor<0)throw Error('Cannot reduce a budget line that does not exist.');
   line={costCenterId:c.costCenterId,category:c.category,
    approvedMinor:0,adjustmentsMinor:0,committedMinor:0,actualMinor:0};
   nextLines.push(line);
  }
  line.adjustmentsMinor+=c.deltaMinor;
  if(remainingMinor(line)<0)
   throw Error('Budget reductions cannot cut into actual or committed spending.');
 }
 if(nextLines.length>200)throw Error('Maximum 200 budget lines per legal entity and financial year.');
 return {...plan,version:plan.version+1,lines:nextLines};
}

export function applyApprovedTransfer(plan:BudgetPlan,transfer:BudgetTransfer):BudgetPlan{
 if(plan.status!=='approved'||plan.legalEntityId!==transfer.legalEntityId||
    plan.fy!==transfer.fy||plan.currency!==transfer.currency)
   throw Error('Transfers must remain within one approved legal-entity budget and financial year.');
 if(!Number.isSafeInteger(transfer.amountMinor)||transfer.amountMinor<=0)
   throw Error('Transfer amount must be a positive whole minor-currency amount.');
 const fromKey=budgetKey(transfer.fromCostCenterId,transfer.fromCategory),
  toKey=budgetKey(transfer.toCostCenterId,transfer.toCategory);
 if(fromKey===toKey)throw Error('The source and destination budget lines must differ.');
 const source=plan.lines.find(l=>budgetKey(l.costCenterId,l.category)===fromKey);
 const target=plan.lines.find(l=>budgetKey(l.costCenterId,l.category)===toKey);
 if(!source||!target)throw Error('Both budget transfer lines must already exist in the approved plan.');
 if(remainingMinor(source)<transfer.amountMinor)
   throw Error('Insufficient uncommitted budget at the source. Budget exceptions cannot create transferrable funds.');
 return {...plan,version:plan.version+1,lines:plan.lines.map(l=>{
  const key=budgetKey(l.costCenterId,l.category);
  return {...l,adjustmentsMinor:l.adjustmentsMinor+(key===fromKey?-transfer.amountMinor:key===toKey?transfer.amountMinor:0)};
 })};
}
export function checkBudget(plan:BudgetPlan|null,cc:string,category:BudgetClass,requestedMinor:number,exception?:BudgetException|null,at?:string,sourceDocumentId?:string):BudgetAvailability{
 if(!Number.isSafeInteger(requestedMinor)||requestedMinor<0)throw Error('Requested amount must be nonnegative minor-currency units.');
 const line=plan?.lines.find(x=>x.costCenterId===cc&&x.category===category);
 if(!plan||plan.status!=='approved'||!line)
  return {status:'no_approved_budget',totalMinor:0,committedMinor:0,actualMinor:0,availableMinor:0,shortfallMinor:requestedMinor,exceptionUsable:false};
 const availableMinor=remainingMinor(line);
 const shortfallMinor=Math.max(0,requestedMinor-availableMinor);
 const exceptionUsable=!!shortfallMinor&&!!exception&&exception.status==='approved'&&
   exception.legalEntityId===plan.legalEntityId&&exception.fy===plan.fy&&
   exception.costCenterId===cc&&exception.category===category&&
   exception.currency===plan.currency&&
   exception.sourceDocumentId===sourceDocumentId&&
   exception.expiresOn>=(at||'9999-12-31')&&shortfallMinor<=exception.maxExtraMinor;
 return {
  status:shortfallMinor&&!exceptionUsable?'requires_exception':'within_budget',
  totalMinor:line.approvedMinor+line.adjustmentsMinor,
  committedMinor:line.committedMinor,actualMinor:line.actualMinor,
  availableMinor,shortfallMinor,exceptionUsable,
 };
}
export function validDate(s:string):boolean{
 return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(new Date(s+'T00:00:00Z').getTime())&&
   new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
}
export function validateFundingAgreement(f:Pick<FundingAgreement,'method'|'currency'|'limitMinor'|'agreementReference'|'purpose'|'effectiveFrom'|'effectiveTo'|'providerLegalEntityId'|'beneficiaryLegalEntityId'|'settlementPolicy'>){
 if(!isFundingMethod(f.method))throw Error('Unknown funding method.');
 if(!/^[A-Z]{3}$/.test(f.currency))throw Error('Funding currency must be an ISO 4217 code.');
 if(!Number.isSafeInteger(f.limitMinor)||f.limitMinor<=0)throw Error('Funding limit must be positive.');
 if(!f.providerLegalEntityId||!f.beneficiaryLegalEntityId||!f.agreementReference.trim()||!f.purpose.trim())
  throw Error('Agreement reference, purpose and both legal-entity parties are required.');
 if(!validDate(f.effectiveFrom)||f.effectiveTo&&!validDate(f.effectiveTo)||
   f.effectiveTo&&f.effectiveTo<f.effectiveFrom)throw Error('Invalid agreement effective dates.');
 if(!['IMMEDIATE','MONTHLY','QUARTERLY','ON_DEMAND','PER_AGREEMENT'].includes(f.settlementPolicy))
  throw Error('Unknown settlement method.');
}
