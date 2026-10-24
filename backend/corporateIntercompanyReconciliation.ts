/**
 * P4 staging reconciliation: supplier/provider vs beneficiary agreement/voucher
 * matching and treasury plan coverage. This is NOT actual GL reconciliation.
 */
import {type IcAgreement,type IcVoucher,type IcSettlementPlan} from './corporateIntercompany';
export type IcStagingRow={
 voucherId:string;agreementId:string;reference:string;providerLegalEntityId:string;
 beneficiaryLegalEntityId:string;currency:string;amountMinor:number;
 stage:'awaiting_beneficiary'|'matched_unposted'|'requires_review';
 approvalsComplete:boolean;plannedSettlementMinor:number;unplannedMinor:number;
 exception:string;
};
export type IcStagingReport={
 rows:IcStagingRow[];currencies:Array<{currency:string;matchedUnpostedMinor:number;
 awaitingMinor:number;plannedSettlementMinor:number;unplannedMinor:number}>;
 unmatchedCount:number;readyUnpostedCount:number;warning:string;
};
export function reconcileStaging(agreements:IcAgreement[],vouchers:IcVoucher[],
 schedules:IcSettlementPlan[]):IcStagingReport{
 const map=new Map(agreements.map(a=>[a.id,a]));
 const planned=new Map<string,number>();
 for(const s of schedules){
  if(s.status!=='planned_only')continue;
  planned.set(s.voucherId,(planned.get(s.voucherId)||0)+s.amountMinor);
 }
 const ids=new Set<string>();
 const rows:IcStagingRow[]=vouchers.map(v=>{
  if(ids.has(v.id))throw Error('Duplicate intercompany voucher ID.');ids.add(v.id);
  const a=map.get(v.agreementId);
  const plannedSettlementMinor=planned.get(v.id)||0;
  const approvalsComplete=v.status==='matched_ready'&&
   !!v.providerApprovalRef&&!!v.beneficiaryApprovalRef&&!!v.beneficiaryApprovedBy;
  const exception=!a?'Agreement missing':
   a.provider.legalEntityId!==v.providerLegalEntityId||
   a.beneficiary.legalEntityId!==v.beneficiaryLegalEntityId?'Agreement parties inconsistent':
   a.invoiceCurrency!==v.currency?'Voucher currency differs from contract':
   plannedSettlementMinor>v.amountMinor?'Planned settlement exceeds voucher amount':'';
  const stage:IcStagingRow['stage']=exception||v.status==='matched_ready'&&!approvalsComplete?
   'requires_review':approvalsComplete?'matched_unposted':'awaiting_beneficiary';
  return {voucherId:v.id,agreementId:v.agreementId,reference:v.sourceReference,
   providerLegalEntityId:v.providerLegalEntityId,
   beneficiaryLegalEntityId:v.beneficiaryLegalEntityId,
   currency:v.currency,amountMinor:v.amountMinor,stage,approvalsComplete,
   plannedSettlementMinor,unplannedMinor:Math.max(0,v.amountMinor-plannedSettlementMinor),exception};
 });
 const currencies=Array.from(new Set(rows.map(r=>r.currency))).sort().map(currency=>{
  const subset=rows.filter(r=>r.currency===currency);
  return {currency,matchedUnpostedMinor:subset.filter(r=>r.stage==='matched_unposted')
    .reduce((sum,r)=>sum+r.amountMinor,0),
   awaitingMinor:subset.filter(r=>r.stage==='awaiting_beneficiary')
    .reduce((sum,r)=>sum+r.amountMinor,0),
   plannedSettlementMinor:subset.reduce((sum,r)=>sum+r.plannedSettlementMinor,0),
   unplannedMinor:subset.reduce((sum,r)=>sum+r.unplannedMinor,0)};
 });
 return {rows,currencies,unmatchedCount:rows.filter(r=>r.stage!=='matched_unposted').length,
  readyUnpostedCount:rows.filter(r=>r.stage==='matched_unposted').length,
  warning:'This report reconciles policy/voucher/settlement INTENTS only. It does not represent GL accounts receivable, accounts payable, bank balances, payments, tax liabilities or group eliminations.'};
}
