/** Read-only P6 posted IC pair checks and group-elimination working paper.
 * This is a financial reconciliation report, NOT a consolidation journal.
 */
import {HttpError,getDoc,listDocs,str} from './core';
import {P} from './finCore';
import type {IcPostingPair} from './corporateIntercompanyPosting';
import type {IcVoucher} from './corporateIntercompany';
export interface PostedIcReportRow{voucherId:string;agreementId:string;currency:string;documentAmountMinor:number;
 providerLegalEntityId:string;beneficiaryLegalEntityId:string;providerJournalId:string;beneficiaryJournalId:string;
 providerFunctionalCurrency:string;beneficiaryFunctionalCurrency:string;providerAmountMinor:number;beneficiaryAmountMinor:number;
 status:'reconciled'|'exception';exception:string;sourceReference:string;type:string;
 consolidationAction:string;}
export interface PostedIcReport {rows:PostedIcReportRow[];postedCount:number;exceptions:number;
 totals:Array<{currency:string;reconciledDocumentMinor:number;exceptionDocumentMinor:number}>;
 note:string;}
const root=(id:string)=>'organizations/'+id;
const valid=(v:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(v);
const cents=(value:unknown)=>Math.round(Number(value)*100);
export function reconcilePairEvidence(pair:IcPostingPair,v:IcVoucher,
 p:Record<string,unknown>|null,b:Record<string,unknown>|null):PostedIcReportRow{
 const errors:string[]=[];
 if(v.status!=='posted'||v.id!==pair.voucherId||v.providerJournalId!==pair.providerJournalId||v.beneficiaryJournalId!==pair.beneficiaryJournalId)
  errors.push('Voucher/pair posted evidence differs');
 if(v.agreementId!==pair.agreementId||v.providerLegalEntityId!==pair.providerLegalEntityId||v.beneficiaryLegalEntityId!==pair.beneficiaryLegalEntityId||v.amountMinor!==pair.sourceAmountMinor||v.currency!==pair.sourceCurrency)
  errors.push('Approved bilateral source differs from posted proof');
 if(!p||!b)errors.push('A legal-entity journal is missing');
 const match=(j:Record<string,unknown>|null,le:string,id:string,role:string)=>
  !!j&&str(j.id)===id&&str(j.leId)===le&&str((j.source as Record<string,unknown>|undefined)?.id)===v.id&&
  str((j.trace as Record<string,unknown>|undefined)?.pairId)===v.id&&
  str((j.trace as Record<string,unknown>|undefined)?.party)===role&&
  j.type==='ICO_CHARGE'&&Math.abs(Number(j.totalDebit)-Number(j.totalCredit))<0.000001;
 if(p&&!match(p,pair.providerLegalEntityId,pair.providerJournalId,'provider'))errors.push('Provider journal source or balancing failed');
 if(b&&!match(b,pair.beneficiaryLegalEntityId,pair.beneficiaryJournalId,'beneficiary'))errors.push('Beneficiary journal source or balancing failed');
 const providerAmountMinor=p?cents(p.totalDebit):0,beneficiaryAmountMinor=b?cents(b.totalDebit):0;
 if(p&&providerAmountMinor!==pair.providerFunctionalMinor)errors.push('Provider amount differs from immutable pair proof');
 if(b&&beneficiaryAmountMinor!==pair.beneficiaryFunctionalMinor)errors.push('Beneficiary amount differs from immutable pair proof');
 const elimination=v.type==='SERVICE_RECHARGE'?
  'Group consolidation WORKPAPER: eliminate intra-group service recovery against matched beneficiary service expense; eliminate intercompany receivable against payable after FX translation and tax checks. Original external group expense remains.' :
  'Group consolidation WORKPAPER: eliminate matched receivable/payable and verified intragroup clearing only; inspect original outside expense. No automatic GL elimination.';
 return {voucherId:v.id,agreementId:v.agreementId,currency:v.currency,documentAmountMinor:v.amountMinor,
  providerLegalEntityId:v.providerLegalEntityId,beneficiaryLegalEntityId:v.beneficiaryLegalEntityId,
  providerJournalId:pair.providerJournalId,beneficiaryJournalId:pair.beneficiaryJournalId,
  providerFunctionalCurrency:v.providerFunctionalCurrency,beneficiaryFunctionalCurrency:v.beneficiaryFunctionalCurrency,
  providerAmountMinor,beneficiaryAmountMinor,status:errors.length?'exception':'reconciled',exception:errors.join('; '),
  sourceReference:v.sourceReference,type:v.type,consolidationAction:elimination};
}
export async function postedIcReport(orgId:string,legalEntityId:string):Promise<PostedIcReport>{
 const pairs=await listDocs(root(orgId)+'/corp_ic_pairs');
 const applicable=pairs.map(x=>x.data as unknown as IcPostingPair)
  .filter(x=>x.providerLegalEntityId===legalEntityId||x.beneficiaryLegalEntityId===legalEntityId);
 if(applicable.length>100)throw new HttpError(409,'Too many posted pairs for one report. Date-scoped financial reporting is required.');
 const rows=await Promise.all(applicable.map(async pair=>{
  if(!valid(pair.id)||!valid(pair.voucherId)||!valid(pair.providerJournalId)||!valid(pair.beneficiaryJournalId))
   throw new HttpError(409,'Invalid immutable intercompany posting reference.');
  const [v,p,b]=await Promise.all([
   getDoc(root(orgId)+'/corp_ic_vouchers/'+pair.voucherId),
   getDoc(P(orgId).journal(pair.providerJournalId)),getDoc(P(orgId).journal(pair.beneficiaryJournalId)),
  ]);
  if(!v)throw new HttpError(409,'Posted voucher is missing. Accounting must investigate.');
  return reconcilePairEvidence(pair,v.data as unknown as IcVoucher,p?.data||null,b?.data||null);
 }));
 const totals=[...new Set(rows.map(r=>r.currency))].sort().map(currency=>{
  const group=rows.filter(r=>r.currency===currency);
  return {currency,reconciledDocumentMinor:group.filter(x=>x.status==='reconciled').reduce((n,x)=>n+x.documentAmountMinor,0),
   exceptionDocumentMinor:group.filter(x=>x.status==='exception').reduce((n,x)=>n+x.documentAmountMinor,0)};
 });
 return {rows,postedCount:rows.length,exceptions:rows.filter(r=>r.status==='exception').length,totals,
  note:'Verifies actual paired Finance journal IDs and document-currency evidence. FX revaluation, translation into group reporting currency, tax, invoice compliance, treasury settlement and consolidation elimination posting are NOT executed.'};
}
