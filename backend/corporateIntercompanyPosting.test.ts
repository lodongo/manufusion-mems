import {test} from 'node:test';
import assert from 'node:assert/strict';
import {icPostingEnabled,validatePostablePair,partyPostingLines,postingInput} from './corporateIntercompanyPosting';
import type {IcAgreement,IcVoucher} from './corporateIntercompany';
const agreement=():IcAgreement=>({
 id:'AGR01',code:'SVC_RECHARGE',name:'IT recharge',
 provider:{legalEntityId:'LEA',accounts:{IC_RECEIVABLE:'1200',SERVICE_RECOVERY:'4100'}},
 beneficiary:{legalEntityId:'LEB',accounts:{SERVICE_EXPENSE:'5100',IC_PAYABLE:'2200'}},
 allowedTypes:['SERVICE_RECHARGE'],invoiceCurrency:'KES',ceilingMinor:10000000,
 startDate:'2026-01-01',endDate:'2027-12-31',settlementPolicy:'MONTHLY',pricingPolicy:'AT_COST',
 taxPolicyReference:'SIGNED-TAX-REVIEW',transferPricingReference:'',supportingAgreementReference:'SLA-001',
 purpose:'Verified shared services',status:'approved_policy',version:2,approvedAt:'2026-10-24',
 approvedBy:'A',providerApprovalRef:'FCR00000001',counterpartyApprovalRef:'FCR00000002',
 counterpartyApprovedAt:'2026-10-24',counterpartyApprovedBy:'B',
});
const voucher=():IcVoucher=>({
 id:'V001',agreementId:'AGR01',sourceReference:'INV-001',type:'SERVICE_RECHARGE',currency:'KES',
 amountMinor:50000000,valueDate:'2026-10-23',providerLegalEntityId:'LEA',beneficiaryLegalEntityId:'LEB',
 taxReviewReference:'TAX-NO-VAT-REVIEWED',transferPricingEvidence:'',
 supportingDocumentReferences:['DOC001'],description:'Group IT services',
 status:'matched_ready',createdAt:'2026-10-23',createdBy:'maker',
 providerApprovedAt:'2026-10-23',providerApprovalRef:'FCR00000003',
 beneficiaryApprovedAt:'2026-10-24',beneficiaryApprovedBy:'approverB',beneficiaryApprovalRef:'FCR00000004',
 providerFunctionalCurrency:'KES',beneficiaryFunctionalCurrency:'KES',providerFxRate:1,beneficiaryFxRate:1,
 providerCostCenterId:'CC_A',beneficiaryCostCenterId:'CC_B',
});
test('P6 is opt-in only for clearly named nonproduction project',()=>{
 assert.equal(icPostingEnabled({MEMS_FIREBASE_PROJECT_ID:'mems-dev-6',MEMS_P6_INTERCOMPANY_POSTING_ENABLED:'true'}),true);
 assert.equal(icPostingEnabled({MEMS_FIREBASE_PROJECT_ID:'mems-production',MEMS_P6_INTERCOMPANY_POSTING_ENABLED:'true'}),false);
 assert.equal(icPostingEnabled({MEMS_FIREBASE_PROJECT_ID:'mems-dev-production',MEMS_P6_INTERCOMPANY_POSTING_ENABLED:'true'}),false);
 assert.equal(icPostingEnabled({MEMS_FIREBASE_PROJECT_ID:'mems-dev-6'}),false);
});
test('P6 matched service vouchers map independent balanced journals to the correct LE cost centres',()=>{
 const a=agreement(),v=voucher();
 assert.doesNotThrow(()=>validatePostablePair(v,a));
 const p=partyPostingLines(v,a,'provider');
 const b=partyPostingLines(v,a,'beneficiary');
 assert.deepEqual(p.map(x=>[x.side,x.glCode,x.ccId]),[['D','1200',''],['C','4100','CC_A']]);
 assert.deepEqual(b.map(x=>[x.side,x.glCode,x.ccId]),[['D','5100','CC_B'],['C','2200','']]);
 assert.equal(p[0].amount,p[1].amount);
 assert.equal(b[0].amount,b[1].amount);
 assert.notEqual(postingInput(v,a,'provider','FCR00000005').sourceKey,postingInput(v,a,'beneficiary','FCR00000005').sourceKey);
});
test('P6 blocks cash, loan, equity, missing cost centres and currencies unsupported by the existing cents GL',()=>{
 const a=agreement(),v=voucher();
 a.allowedTypes=['LOAN_ADVANCE'];v.type='LOAN_ADVANCE';
 assert.throws(()=>validatePostablePair(v,a),/treasury release/);
 const b=agreement(),z=voucher();z.providerCostCenterId='';
 assert.throws(()=>validatePostablePair(z,b),/cost-centre/);
 z.providerCostCenterId='CC_A';z.beneficiaryFunctionalCurrency='KWD';
 assert.throws(()=>validatePostablePair(z,b),/two-decimal/);
});
