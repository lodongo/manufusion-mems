import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessP6Readiness} from './corporateIntercompanyReadiness';
import type {IcVoucher,IcAgreement} from './corporateIntercompany';
const agreement=():IcAgreement=>({id:'AGR01',code:'SVC',name:'Group service',
 provider:{legalEntityId:'LEA',accounts:{IC_RECEIVABLE:'A120',SERVICE_RECOVERY:'A410'}},
 beneficiary:{legalEntityId:'LEB',accounts:{SERVICE_EXPENSE:'B510',IC_PAYABLE:'B220'}},
 allowedTypes:['SERVICE_RECHARGE'],invoiceCurrency:'KES',ceilingMinor:500000,
 startDate:'2026-01-01',endDate:'2026-12-31',settlementPolicy:'MONTHLY',pricingPolicy:'AT_COST',
 taxPolicyReference:'TAX-APPROVED',transferPricingReference:'',supportingAgreementReference:'AGREEMENT',
 purpose:'Verified shared IT services',status:'approved_policy',version:1,approvedAt:'2026-10-20',
 approvedBy:'makerA',providerApprovalRef:'FCR00000001',
 counterpartyApprovalRef:'FCR00000002',counterpartyApprovedAt:'2026-10-21',counterpartyApprovedBy:'reviewerB'});
const voucher=():IcVoucher=>({id:'V001',agreementId:'AGR01',sourceReference:'SVC001',type:'SERVICE_RECHARGE',
 currency:'KES',amountMinor:200000,valueDate:'2026-10-23',providerLegalEntityId:'LEA',beneficiaryLegalEntityId:'LEB',
 taxReviewReference:'TAX-REVIEW-A',transferPricingEvidence:'',supportingDocumentReferences:['SRC'],
 description:'Shared costs',status:'matched_ready',createdAt:'',createdBy:'makerA',
 providerApprovedAt:'',providerApprovalRef:'FCR00000003',beneficiaryApprovedAt:'',
 beneficiaryApprovedBy:'reviewerB',beneficiaryApprovalRef:'FCR00000004',
 providerFunctionalCurrency:'KES',beneficiaryFunctionalCurrency:'KES',providerFxRate:1,beneficiaryFxRate:1,
 providerCostCenterId:'CCA',beneficiaryCostCenterId:'CCB'});
const provider=(v:IcVoucher)=>({type:'corp.ic.voucher',status:'approved',leId:'LEA',payload:{voucher:{id:v.id}},result:{voucherId:v.id}});
const beneficiary=(v:IcVoucher)=>({type:'corp.ic.voucher.accept',status:'approved',leId:'LEB',payload:{voucherId:v.id},result:{voucherId:v.id}});
const valid=()=>{const v=voucher();return {voucher:v,agreement:agreement(),providerApproval:provider(v),beneficiaryApproval:beneficiary(v),providerReady:true,beneficiaryReady:true,alreadyPosted:false,postingEnabled:true}};
test('P6 preflight reports complete machine verifications without claiming human sign-off',()=>{
 const r=assessP6Readiness(valid());
 assert.equal(r.checks.length,7);
 assert.equal(r.checks.filter(c=>c.passed).length,7);
 assert.equal(r.readyForApplicationTest,true);
 assert.equal(r.operationallyAuthorized,false);
 assert.ok(r.manualReleaseGates.some(s=>s.includes('Finance and Tax sign-off')));
});
test('P6 preflight fails closed for mismatched source, unrelated approved FCR and disabled posting',()=>{
 const r=valid();r.providerApproval={...provider(r.voucher),payload:{voucher:{id:'OTHER'}}};
 r.beneficiaryApproval={...beneficiary(r.voucher),result:{voucherId:'OTHER'}};
 r.postingEnabled=false;
 const report=assessP6Readiness(r);
 assert.equal(report.readyForApplicationTest,false);
 assert.deepEqual(report.checks.filter(c=>!c.passed).map(c=>c.code),[
  'provider-independent-approval','beneficiary-independent-approval','explicit-isolated-development-activation']);
});
test('P6 preflight blocks posted pairs, missing mapping and closed finance periods',()=>{
 const r=valid();r.alreadyPosted=true;r.providerReady=false;
 r.voucher.providerCostCenterId='';
 const checks=assessP6Readiness(r);
 assert.equal(checks.readyForApplicationTest,false);
 assert.ok(checks.checks.some(c=>c.code==='signed-agreement-and-matched-source'&&!c.passed));
 assert.ok(checks.checks.some(c=>c.code==='source-not-yet-posted'&&!c.passed));
});
test('P6 preflight recognizes source-bound approved allocation-generated provider voucher',()=>{
 const r=valid();r.voucher.allocationPolicyId='POOL1';r.voucher.allocationSourceJournalId='J01';
 r.providerApproval={type:'corp.allocation.execute',status:'approved',leId:'LEA',result:{voucherIds:['V001']}};
 assert.equal(assessP6Readiness(r).checks.find(c=>c.code==='provider-independent-approval')?.passed,true);
});
