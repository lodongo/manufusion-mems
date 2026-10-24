import {test} from 'node:test';
import {reconcileStaging} from './corporateIntercompanyReconciliation';
import assert from 'node:assert/strict';
import {
 IC_TYPES,accountRequirements,validateAgreement,validateVoucher,
 agreementEffective,previewIntercompany,validateSettlementPlan,nettingPreview,
 type IcAgreement,type IcVoucher,type IcSettlementPlan,
} from './corporateIntercompany';
const contract=():IcAgreement=>({
 id:'ic001',code:'GROUP_IT',name:'Group IT Shared Service',
 provider:{legalEntityId:'EA',accounts:{
  IC_RECEIVABLE:'120-01',SERVICE_RECOVERY:'410-01',
  LOAN_RECEIVABLE:'140-01',BANK:'100-01',EQUITY_INVESTMENT:'150-01',
 }},
 beneficiary:{legalEntityId:'EB',accounts:{
  IC_PAYABLE:'220-01',SERVICE_EXPENSE:'510-01',
  LOAN_PAYABLE:'240-01',BANK:'100-03',EQUITY_CAPITAL:'310-01',
 }},
 allowedTypes:['SERVICE_RECHARGE','LOAN_ADVANCE','LOAN_REPAYMENT','CAPITAL_CONTRIBUTION'],
 invoiceCurrency:'KES',ceilingMinor:40000000,
 startDate:'2026-10-01',endDate:'2027-09-30',
 settlementPolicy:'MONTHLY',pricingPolicy:'AT_COST',
 taxPolicyReference:'TAX-REVIEW-2026-08',
 transferPricingReference:'TP-GROUP-2026',
 supportingAgreementReference:'SIGNED-SLA-212',
 purpose:'Shared services and treasury terms approved by both entities.',
 status:'approved_policy',version:2,approvedAt:'2026-10-14',
 approvedBy:'CFO-A',providerApprovalRef:'FCR00000010',
 counterpartyApprovedBy:'CFO-B',counterpartyApprovedAt:'2026-10-16',
 counterpartyApprovalRef:'FCR00000011',
});
const voucher=():IcVoucher=>({
 id:'icv001',agreementId:'ic001',sourceReference:'INV-2026-009',
 type:'SERVICE_RECHARGE',currency:'KES',amountMinor:1000000,
 valueDate:'2026-10-23',providerLegalEntityId:'EA',beneficiaryLegalEntityId:'EB',
 taxReviewReference:'TAX-REVIEW-009',transferPricingEvidence:'',
 supportingDocumentReferences:['DOC-2026-121','SLA-212'],
 description:'IT shared services for reporting month.',
 status:'matched_ready',createdAt:'2026-10-23',createdBy:'FIN-A',
 providerApprovedAt:'2026-10-24',providerApprovalRef:'FCR00000012',
 beneficiaryApprovedAt:'2026-10-24',beneficiaryApprovedBy:'FIN-B',
 beneficiaryApprovalRef:'FCR00000013',
 providerFunctionalCurrency:'KES',beneficiaryFunctionalCurrency:'KES',
 providerFxRate:1,beneficiaryFxRate:1,
});
test('P4 types do not conflate loans, equity and ordinary recharges',()=>{
 assert.deepEqual(IC_TYPES.map(t=>t.code),[
  'SERVICE_RECHARGE','COST_REIMBURSEMENT','LOAN_ADVANCE',
  'LOAN_REPAYMENT','CAPITAL_CONTRIBUTION','ON_BEHALF_PAYMENT']);
 assert.deepEqual(accountRequirements('SERVICE_RECHARGE'),
  [['IC_RECEIVABLE','SERVICE_RECOVERY'],['SERVICE_EXPENSE','IC_PAYABLE']]);
 assert.deepEqual(accountRequirements('LOAN_ADVANCE'),
  [['LOAN_RECEIVABLE','BANK'],['BANK','LOAN_PAYABLE']]);
 assert.deepEqual(accountRequirements('CAPITAL_CONTRIBUTION'),
  [['EQUITY_INVESTMENT','BANK'],['BANK','EQUITY_CAPITAL']]);
});
test('P4 contract must be bilateral, effective-dated and fully mapped',()=>{
 assert.doesNotThrow(()=>validateAgreement(contract()));
 assert.equal(agreementEffective(contract(),'2026-12-01'),true);
 assert.equal(agreementEffective(contract(),'2028-01-01'),false);
 const a=contract();a.provider.legalEntityId='EB';
 assert.throws(()=>validateAgreement(a),/different legal entities/);
 const b=contract();delete b.provider.accounts.IC_RECEIVABLE;
 assert.throws(()=>validateAgreement(b),/required mapped GL/);
 const c=contract();c.taxPolicyReference='';
 assert.throws(()=>validateAgreement(c),/tax-treatment/);
});
test('P4 mirrors balanced service recharge without posting or invoice',()=>{
 const preview=previewIntercompany(voucher(),contract());
 assert.equal(preview.postingEnabled,false);
 assert.equal(preview.needsTaxReview,true);
 assert.equal(preview.provider.debitsMinor,1000000);
 assert.equal(preview.provider.creditsMinor,1000000);
 assert.deepEqual(preview.provider.lines.map(x=>[x.side,x.role]),[
  ['D','IC_RECEIVABLE'],['C','SERVICE_RECOVERY']]);
 assert.deepEqual(preview.beneficiary.lines.map(x=>[x.side,x.role]),[
  ['D','SERVICE_EXPENSE'],['C','IC_PAYABLE']]);
});
test('P4 FX conversion preserves independent balanced functional ledgers',()=>{
 const a=contract(),v=voucher();
 v.beneficiaryFunctionalCurrency='KWD';
 v.beneficiaryFxRate=0.0023;
 const preview=previewIntercompany(v,a);
 assert.equal(preview.provider.functionalAmountMinor,1000000);
 assert.equal(preview.beneficiary.functionalAmountMinor,23000);
 assert.equal(preview.beneficiary.debitsMinor,preview.beneficiary.creditsMinor);
});
test('P4 voucher requires agreement, tax evidence, source reference and ceiling',()=>{
 assert.doesNotThrow(()=>validateVoucher(voucher(),contract()));
 const v=voucher();v.amountMinor=999999999;
 assert.throws(()=>validateVoucher(v,contract()),/ceiling/);
 const b=voucher();b.taxReviewReference='';
 assert.throws(()=>validateVoucher(b,contract()),/Tax treatment/);
 const c=voucher();c.beneficiaryLegalEntityId='EA';
 assert.throws(()=>validateVoucher(c,contract()),/exactly match/);
});
test('P4 settlement plan cannot imply cash transfer, exceed voucher or predate source',()=>{
 const p:IcSettlementPlan={id:'S1',voucherId:'icv001',agreementId:'ic001',
  currency:'KES',amountMinor:1000000,plannedDate:'2026-11-01',method:'BANK_TRANSFER',
  paymentReference:'SCHEDULE-01',reason:'Pay within thirty days',
  status:'planned_only',approvedAt:'2026-10-24',approvalRef:'FCR00000015'};
 assert.doesNotThrow(()=>validateSettlementPlan(p,voucher(),contract()));
 assert.throws(()=>validateSettlementPlan({...p,amountMinor:2000000},voucher(),contract()),/exceed/);
 assert.throws(()=>validateSettlementPlan({...p,plannedDate:'2026-09-01'},voucher(),contract()),/settlement date/);
});
test('P4 currency-specific netting is nonposting, and never nets a different currency',()=>{
 const lines=nettingPreview([{legalEntityId:'EA',counterpartyLegalEntityId:'EB',
  currency:'KES',receivableMinor:12000,payableMinor:4000}]);
 assert.equal(lines[0].netReceivableMinor,8000);
 assert.equal(lines[0].netPayableMinor,0);
 assert.throws(()=>nettingPreview([
  {legalEntityId:'EA',counterpartyLegalEntityId:'EB',currency:'KES',receivableMinor:10,payableMinor:0},
  {legalEntityId:'EA',counterpartyLegalEntityId:'EB',currency:'KES',receivableMinor:10,payableMinor:0},
 ]),/Duplicate/);
});

test('P4 staging reconciliation clearly separates matched unposted, pending and planned only',()=>{
 const a=contract(),ready=voucher(),pending={...voucher(),id:'icv002',sourceReference:'INV-2026-010',
  status:'awaiting_counterparty' as const,beneficiaryApprovedBy:'',beneficiaryApprovalRef:''};
 const settlement:IcSettlementPlan={id:'S001',agreementId:a.id,voucherId:ready.id,
  currency:'KES',amountMinor:200000,plannedDate:'2026-11-01',
  method:'MANUAL',paymentReference:'PLAN-001',reason:'Expected partial settlement',
  status:'planned_only',approvedAt:'2026-10-24',approvalRef:'FCR00000033'};
 const r=reconcileStaging([a],[ready,pending],[settlement]);
 assert.equal(r.readyUnpostedCount,1);
 assert.equal(r.unmatchedCount,1);
 assert.equal(r.currencies[0].matchedUnpostedMinor,1000000);
 assert.equal(r.currencies[0].plannedSettlementMinor,200000);
 assert.match(r.warning,/not represent GL/);
});
