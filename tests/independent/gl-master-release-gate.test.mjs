import test from 'node:test';
import assert from 'node:assert/strict';
import {integratedReleaseProblems} from '../../backend/catalogueReleaseGuard.ts';
function base(){
 return {financialIntegration:{catalogueRelease:'APPROVED',mappingReviewRequired:false,
   notAuthorizedForPosting:false,financeReleaseApproval:{approvedBy:'checker',approvedAt:'2026-10-27T08:00:00Z',approvalReference:'FCR-12345678'}}};
}
test('Draft GL review cannot activate even if someone flips the release label',()=>{
 const gl={...base(),accounts:[{code:'10304080',pendingFinanceApproval:true,accountDetermination:{mappingStatus:'finance_review_required'},usedInProcurement:false,usedInProcurementPosting:false}]};
 assert.match(integratedReleaseProblems('gl_accounts',gl).join(' '),/unapproved GL account/);
 gl.accounts[0].accountDetermination.mappingStatus='reference_validated_pending_finance_approval';
 assert.match(integratedReleaseProblems('gl_accounts',gl).join(' '),/unapproved GL account/);
});
test('Reference-reviewed materials cannot import under an APPROVED root label',()=>{
 const materials={...base(),materials:[{code:'MAT-A',accounting:{glResolution:{mappingStatus:'reference_validated_pending_finance_approval',referenceOnly:true,postingEnabled:false,transactionRoutes:[{event:'GOODS_RECEIPT',glCode:'10304080',postingActive:false}]}}}]};
 assert.match(integratedReleaseProblems('materials',materials).join(' '),/unapproved financial mapping/);
});
test('Service and asset masters share the same closed approval gate',()=>{
 for(const [kind,key] of [['services','services'],['assets','assetClasses']]){
  const doc={...base(),[key]:[{code:'A1',accounting:{glResolution:{mappingStatus:'reference_proposed'}}}]};
  assert.ok(integratedReleaseProblems(kind,doc).some(x=>x.includes('unapproved financial mapping')));
 }
});
test('Fully signed-off, validated mapping with posting disabled can be admitted for release',()=>{
 const doc={...base(),services:[{code:'S1',accounting:{glResolution:{mappingStatus:'approved',referenceOnly:true,postingEnabled:false,
 transactionRoutes:[{event:'SVC_ACCEPT',glCode:'62101010',status:'approved',postingActive:false}]}}}]};
 assert.deepEqual(integratedReleaseProblems('services',doc),[]);
});
test('Approval needs signoff evidence, and GL must not have contradictory procurement flags',()=>{
 const gl={...base(),accounts:[{code:'10304080',pendingFinanceApproval:false,accountDetermination:{mappingStatus:'approved'},usedInProcurement:false,usedInProcurementPosting:true}]};
 gl.financialIntegration.financeReleaseApproval={};
 assert.ok(integratedReleaseProblems('gl_accounts',gl).some(x=>x.includes('Finance sign-off')));
 assert.ok(integratedReleaseProblems('gl_accounts',gl).some(x=>x.includes('procurement posting flag')));
});
test('All existing admin-import paths enforce the new gate, even after renaming pending status',async()=>{
 const fs=await import('node:fs');
 for(const file of ['backend/procurement.ts','backend/assets.ts']){
  const body=fs.readFileSync(file,'utf8');
  assert.match(body,/integratedReleaseProblems\(/);
  assert.match(body,/mappingStatus\)!=='approved'/);
 }
});
