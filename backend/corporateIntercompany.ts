/**
 * P4 intercompany contract and mirrored journal-INTENT model.
 * All outputs are pre-posting previews. They NEVER create a finance journal, bank
 * instruction, statutory invoice, tax return, consolidation or settlement.
 */
import {currencyDigits,minorFactor,majorFromMinor} from './corporateBudget';

export const IC_TYPES=[
 {code:'SERVICE_RECHARGE',label:'Shared services / recharge'},
 {code:'COST_REIMBURSEMENT',label:'At-cost reimbursement'},
 {code:'LOAN_ADVANCE',label:'Intercompany loan advance'},
 {code:'LOAN_REPAYMENT',label:'Intercompany loan repayment'},
 {code:'CAPITAL_CONTRIBUTION',label:'Equity capital contribution'},
 {code:'ON_BEHALF_PAYMENT',label:'Payment on another entity’s behalf'},
] as const;
export type IcType=typeof IC_TYPES[number]['code'];
export const IC_SETTLEMENT=[
 {code:'IMMEDIATE',label:'Immediate settlement'},
 {code:'MONTHLY',label:'Monthly reconciliation and settlement'},
 {code:'QUARTERLY',label:'Quarterly'},
 {code:'ON_DEMAND',label:'On demand'},
 {code:'PER_AGREEMENT',label:'As agreed'},
] as const;
export const IC_ROLES={
 IC_RECEIVABLE:'BS',IC_PAYABLE:'BS',LOAN_RECEIVABLE:'BS',LOAN_PAYABLE:'BS',
 BANK:'BS',SERVICE_RECOVERY:'PL',SERVICE_EXPENSE:'PL',
 REIMBURSEMENT_CLEARING:'BS',EQUITY_INVESTMENT:'BS',EQUITY_CAPITAL:'BS',
} as const;
export type IcRole=keyof typeof IC_ROLES;
export type IcAccounts=Partial<Record<IcRole,string>>;
export type IcParty={legalEntityId:string;accounts:IcAccounts};
export type IcAgreement={
 id:string;code:string;name:string;provider:IcParty;beneficiary:IcParty;
 allowedTypes:IcType[];invoiceCurrency:string;ceilingMinor:number;
 startDate:string;endDate:string;settlementPolicy:typeof IC_SETTLEMENT[number]['code'];
 pricingPolicy:'AT_COST'|'CONTRACT';
 taxPolicyReference:string;transferPricingReference:string;
 supportingAgreementReference:string;purpose:string;
 status:'awaiting_counterparty'|'approved_policy';
 version:number;approvedAt:string;approvedBy:string;providerApprovalRef:string;
 counterpartyApprovalRef:string;counterpartyApprovedAt:string;counterpartyApprovedBy:string;
};
export type IcVoucher={
 id:string;agreementId:string;sourceReference:string;
 type:IcType;currency:string;amountMinor:number;valueDate:string;
 providerLegalEntityId:string;beneficiaryLegalEntityId:string;
 taxReviewReference:string;transferPricingEvidence:string;
 supportingDocumentReferences:string[];
 description:string;status:'awaiting_counterparty'|'matched_ready'|'posted';
 providerCostCenterId?:string;beneficiaryCostCenterId?:string;
 allocationPolicyId?:string;allocationSourceJournalId?:string;
 postingApprovalRef?:string;postedAt?:string;providerJournalId?:string;beneficiaryJournalId?:string;
 createdAt:string;createdBy:string;providerApprovedAt:string;providerApprovalRef:string;
 beneficiaryApprovedAt:string;beneficiaryApprovedBy:string;beneficiaryApprovalRef:string;
 providerFunctionalCurrency:string;beneficiaryFunctionalCurrency:string;
 providerFxRate:number;beneficiaryFxRate:number;
};
export type IcJournalLine={side:'D'|'C';role:IcRole;glCode:string;amountMinor:number};
export type IcJournalPreview={
 legalEntityId:string;functionalCurrency:string;fxRate:number;
 functionalAmountMinor:number;debitsMinor:number;creditsMinor:number;lines:IcJournalLine[];
};
export type IcPreview={
 postingEnabled:false;documentCurrency:string;documentAmountMinor:number;
 provider:IcJournalPreview;beneficiary:IcJournalPreview;
 needsTaxReview:boolean;needsManualPeriodAndAccountValidation:true;
 warning:string;
};
export type IcSettlementPlan={
 id:string;voucherId:string;agreementId:string;currency:string;
 amountMinor:number;plannedDate:string;method:'BANK_TRANSFER'|'INTERCOMPANY_NETTING'|'CASH_POOL'|'MANUAL';
 paymentReference:string;reason:string;
 status:'planned_only';approvedAt:string;approvalRef:string;
};
export type IcNettingLine={legalEntityId:string;counterpartyLegalEntityId:string;currency:string;
 receivableMinor:number;payableMinor:number};
const codeSet=new Set<string>(IC_TYPES.map(x=>x.code));
const roles=Object.keys(IC_ROLES) as IcRole[];
const dateValid=(x:string)=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 !Number.isNaN(new Date(x+'T00:00:00Z').getTime())&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const minor=(n:number)=>Number.isSafeInteger(n)&&n>0;
const safeCode=(x:string)=>/^[A-Z][A-Z0-9_-]{2,40}$/.test(x);
export const agreementEffective=(a:IcAgreement,date:string)=>
 a.status==='approved_policy'&&dateValid(date)&&date>=a.startDate&&(!a.endDate||date<=a.endDate);
export function accountRequirements(type:IcType):[IcRole[],IcRole[]]{
 switch(type){
 case 'SERVICE_RECHARGE':return [['IC_RECEIVABLE','SERVICE_RECOVERY'],['SERVICE_EXPENSE','IC_PAYABLE']];
 case 'COST_REIMBURSEMENT':return [['IC_RECEIVABLE','REIMBURSEMENT_CLEARING'],['REIMBURSEMENT_CLEARING','IC_PAYABLE']];
 case 'LOAN_ADVANCE':return [['LOAN_RECEIVABLE','BANK'],['BANK','LOAN_PAYABLE']];
 case 'LOAN_REPAYMENT':return [['BANK','LOAN_RECEIVABLE'],['LOAN_PAYABLE','BANK']];
 case 'CAPITAL_CONTRIBUTION':return [['EQUITY_INVESTMENT','BANK'],['BANK','EQUITY_CAPITAL']];
 case 'ON_BEHALF_PAYMENT':return [['IC_RECEIVABLE','BANK'],['REIMBURSEMENT_CLEARING','IC_PAYABLE']];
 }
}
export function validateAgreement(a:IcAgreement):IcAgreement{
 if(!safeCode(a.code)||!a.id||!a.name.trim()||!a.purpose.trim()||!a.supportingAgreementReference.trim())
  throw Error('Intercompany agreement requires a code, name, purpose and supporting contract reference.');
 if(!a.provider.legalEntityId||!a.beneficiary.legalEntityId||
  a.provider.legalEntityId===a.beneficiary.legalEntityId)
  throw Error('An intercompany agreement must connect two different legal entities.');
 currencyDigits(a.invoiceCurrency);
 if(!minor(a.ceilingMinor))throw Error('Agreement financial ceiling must be positive minor-currency units.');
 if(!dateValid(a.startDate)||a.endDate&&!dateValid(a.endDate)||a.endDate&&a.endDate<a.startDate)
  throw Error('Agreement effective dates are invalid.');
 if(!IC_SETTLEMENT.some(x=>x.code===a.settlementPolicy))
  throw Error('Unknown intercompany settlement policy.');
 if(!['AT_COST','CONTRACT'].includes(a.pricingPolicy)||!a.taxPolicyReference.trim())
  throw Error('A pricing policy and tax-treatment review reference are mandatory.');
 if(a.pricingPolicy==='CONTRACT'&&!a.transferPricingReference.trim())
  throw Error('Contract-priced intragroup services require a transfer-pricing reference.');
 if(!a.allowedTypes.length||new Set(a.allowedTypes).size!==a.allowedTypes.length||
    a.allowedTypes.some(x=>!codeSet.has(x)))
  throw Error('Select valid, unique intercompany transaction types.');
 for(const party of [a.provider,a.beneficiary]){
  for(const [r,gl] of Object.entries(party.accounts)){
   if(!roles.includes(r as IcRole)||typeof gl!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(gl))
    throw Error('Invalid GL account role or code in intercompany agreement.');
  }
 }
 for(const type of a.allowedTypes){
  const [p,b]=accountRequirements(type);
  if(p.some(x=>!a.provider.accounts[x])||b.some(x=>!a.beneficiary.accounts[x]))
   throw Error('Every permitted transaction type must have the required mapped GL roles for both legal entities: '+type);
 }
 return a;
}
export function validateVoucher(v:IcVoucher,a:IcAgreement):IcVoucher{
 validateAgreement(a);
 if(v.agreementId!==a.id||v.providerLegalEntityId!==a.provider.legalEntityId||
  v.beneficiaryLegalEntityId!==a.beneficiary.legalEntityId)
  throw Error('Voucher parties must exactly match the bilateral agreement.');
 if(!a.allowedTypes.includes(v.type)||v.currency!==a.invoiceCurrency)
  throw Error('Voucher type or document currency is not permitted by the agreement.');
 if(!dateValid(v.valueDate)||v.valueDate<a.startDate||a.endDate&&v.valueDate>a.endDate)
  throw Error('Voucher posting date must be inside the agreement validity period.');
 if(!minor(v.amountMinor)||v.amountMinor>a.ceilingMinor)
  throw Error('Voucher must have a positive amount within the agreement ceiling.');
 if(!v.sourceReference.trim()||!v.description.trim()||!v.supportingDocumentReferences.length||
  v.supportingDocumentReferences.some(x=>!x.trim()))
  throw Error('Source reference, narrative and supporting documents are mandatory.');
 if(!v.taxReviewReference.trim())
  throw Error('Tax treatment must be independently reviewed and referenced before the voucher is accepted.');
 if(a.pricingPolicy==='CONTRACT'&&!v.transferPricingEvidence.trim())
  throw Error('Provide transfer-pricing evidence for contract-priced service transactions.');
 for(const [cur,rate] of [
  [v.providerFunctionalCurrency,v.providerFxRate],[v.beneficiaryFunctionalCurrency,v.beneficiaryFxRate],
 ] as Array<[string,number]>){
  currencyDigits(cur);
  if(!Number.isFinite(rate)||rate<=0||rate>1e12)
   throw Error('Both legal entities require valid, positive FX rate snapshots.');
 }
 return v;
}
function journal(a:IcAgreement,v:IcVoucher,party:'provider'|'beneficiary'):IcJournalPreview{
 const side=party==='provider'?a.provider:a.beneficiary;
 const fx=party==='provider'?v.providerFxRate:v.beneficiaryFxRate;
 const currency=party==='provider'?v.providerFunctionalCurrency:v.beneficiaryFunctionalCurrency;
 const functionalAmountMinor=Math.round(v.amountMinor/minorFactor(v.currency)*fx*minorFactor(currency));
 if(!minor(functionalAmountMinor))throw Error('Converted value is zero or outside integer minor-unit precision.');
 const rolesByType=accountRequirements(v.type)[party==='provider'?0:1];
 const lines:IcJournalLine[]=rolesByType.map((role,i)=>({
  side:i===0?'D':'C',role,glCode:side.accounts[role]||'',amountMinor:functionalAmountMinor,
 }));
 const debitsMinor=lines.filter(l=>l.side==='D').reduce((s,l)=>s+l.amountMinor,0);
 const creditsMinor=lines.filter(l=>l.side==='C').reduce((s,l)=>s+l.amountMinor,0);
 if(debitsMinor!==creditsMinor)throw Error('Mirrored journal must balance within each legal entity.');
 return {legalEntityId:side.legalEntityId,functionalCurrency:currency,fxRate:fx,
  functionalAmountMinor,debitsMinor,creditsMinor,lines};
}
export function previewIntercompany(v:IcVoucher,a:IcAgreement):IcPreview{
 validateVoucher(v,a);
 return {postingEnabled:false,documentCurrency:v.currency,documentAmountMinor:v.amountMinor,
  provider:journal(a,v,'provider'),beneficiary:journal(a,v,'beneficiary'),
  needsTaxReview:true,needsManualPeriodAndAccountValidation:true,
  warning:'Dual journals are unposted INTENTS. Tax, GL period, cash, intercompany balances and consolidated eliminations require a separate verified atomic posting service.'};
}
export function validateSettlementPlan(s:IcSettlementPlan,v:IcVoucher,a:IcAgreement){
 if(s.voucherId!==v.id||s.agreementId!==a.id||s.currency!==v.currency||
    v.status!=='matched_ready'||!dateValid(s.plannedDate)||s.plannedDate<v.valueDate)
  throw Error('Settlement plan requires a matched voucher, same currency and valid settlement date.');
 if(!minor(s.amountMinor)||s.amountMinor>v.amountMinor)
  throw Error('Settlement cannot exceed the matching voucher amount.');
 if(!['BANK_TRANSFER','INTERCOMPANY_NETTING','CASH_POOL','MANUAL'].includes(s.method))
  throw Error('Invalid settlement planning method.');
 if(!s.paymentReference.trim()||!s.reason.trim())
  throw Error('Settlement intent requires a reference and a business reason.');
}
export function nettingPreview(lines:IcNettingLine[]):Array<{legalEntityId:string;counterpartyLegalEntityId:string;
 currency:string;netReceivableMinor:number;netPayableMinor:number}>{
 const keys=new Set<string>();
 return lines.map(l=>{
  const key=l.legalEntityId+'|'+l.counterpartyLegalEntityId+'|'+l.currency;
  if(keys.has(key))throw Error('Duplicate netting counterparty and currency.');keys.add(key);
  currencyDigits(l.currency);
  if(!Number.isSafeInteger(l.receivableMinor)||l.receivableMinor<0||
     !Number.isSafeInteger(l.payableMinor)||l.payableMinor<0)
   throw Error('Netting balances must be nonnegative integer minor units.');
  const net=l.receivableMinor-l.payableMinor;
  return {legalEntityId:l.legalEntityId,counterpartyLegalEntityId:l.counterpartyLegalEntityId,
   currency:l.currency,netReceivableMinor:Math.max(0,net),netPayableMinor:Math.max(0,-net)};
 });
}
