import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePairEvidence} from './corporateIntercompanyPostedReport';
import type {IcPostingPair} from './corporateIntercompanyPosting';
import type {IcVoucher} from './corporateIntercompany';
const pair=():IcPostingPair=>({id:'V001',voucherId:'V001',agreementId:'AGR01',postedAt:'2026-10-24',postedBy:'financeController',approvalRef:'FCR00000005',providerJournalId:'JA',beneficiaryJournalId:'JB',providerLegalEntityId:'EA',beneficiaryLegalEntityId:'EB',sourceCurrency:'KES',sourceAmountMinor:5000000,providerFunctionalMinor:5000000,beneficiaryFunctionalMinor:5000000,status:'posted'});
const voucher=():IcVoucher=>({id:'V001',agreementId:'AGR01',sourceReference:'INV001',type:'SERVICE_RECHARGE',currency:'KES',amountMinor:5000000,valueDate:'2026-10-24',providerLegalEntityId:'EA',beneficiaryLegalEntityId:'EB',taxReviewReference:'TAX123',transferPricingEvidence:'',supportingDocumentReferences:['DOC'],description:'test',status:'posted',createdAt:'',createdBy:'',providerApprovedAt:'',providerApprovalRef:'FCR00000003',beneficiaryApprovedAt:'',beneficiaryApprovedBy:'b',beneficiaryApprovalRef:'FCR00000004',providerFunctionalCurrency:'KES',beneficiaryFunctionalCurrency:'KES',providerFxRate:1,beneficiaryFxRate:1,providerJournalId:'JA',beneficiaryJournalId:'JB'});
const journal=(id:string,le:string,party:string)=>({id,leId:le,type:'ICO_CHARGE',source:{id:'V001'},trace:{pairId:'V001',party},totalDebit:50000,totalCredit:50000});
test('P6 GL reconciliation verifies both posted pair references, amounts and source trail',()=>{
 const r=reconcilePairEvidence(pair(),voucher(),journal('JA','EA','provider'),journal('JB','EB','beneficiary'));
 assert.equal(r.status,'reconciled');
 assert.match(r.consolidationAction,/WORKPAPER/);
 assert.equal(r.providerAmountMinor,5000000);
});
test('P6 posted ledger pair errors never silently count as reconciled',()=>{
 assert.equal(reconcilePairEvidence(pair(),voucher(),journal('JA','EA','provider'),null).status,'exception');
 assert.match(reconcilePairEvidence(pair(),voucher(),journal('JA','WRONG','provider'),journal('JB','EB','beneficiary')).exception,/Provider journal/);
});
