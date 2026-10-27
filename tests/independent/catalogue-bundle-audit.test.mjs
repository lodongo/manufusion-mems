import test from 'node:test';
import assert from 'node:assert/strict';
import {auditIntegratedMasterBundle} from '../../scripts/audit-integrated-catalogues.mjs';

function bundle(){
 const header=(n)=>({
  financialIntegration:{masterBundleId:'B-123',referenceGLVersion:'3.1',catalogueRelease:'DRAFT_FINANCE_REVIEW',notAuthorizedForPosting:true},
  industryIntegration:{taxonomyVersion:'MEMS-IND-2.0',originalEntryCount:n}
 });
 const route={event:'GOODS_RECEIPT',glCode:'10305020',postingActive:false};
 const accounting=(branch)=>({
  catalogueClassification:{majorBranch:branch},
  glResolution:{mappingStatus:'reference_proposed',mode:branch==='MRO'?'work_order_context':'catalogue_transaction',
   maintenanceStrategyRequiredForConsumption:branch==='MRO',postingEnabled:false,transactionRoutes:[route]}
 });
 return {
  gl:{...header(1),version:'3.1',accounts:[{code:'10305020',industryScope:'COMMON',industryCodes:[],
   usedInProcurement:false,usedInBudget:true,usedInProcurementPosting:false,pendingFinanceApproval:true,
   accountDetermination:{mappingStatus:'reference_proposed'}}]},
  materials:{...header(2),materials:[
   {code:'MAT-MRO',industryScope:'INDUSTRY_SPECIFIC',industryCodes:['IND-C'],accounting:accounting('MRO')},
   {code:'MAT-NON',industryScope:'COMMON',industryCodes:[],accounting:accounting('NON_MRO')}]},
  services:{...header(1),services:[{code:'SV-1',industryScope:'COMMON',industryCodes:[],accounting:accounting('')}]},
  assets:{...header(1),assetClasses:[{code:'AS-1',industryScope:'COMMON',industryCodes:[],accounting:accounting('')}]}
 };
}
test('Four-master draft reconciles codes and reports unapproved references honestly',()=>{
 const result=auditIntegratedMasterBundle(bundle());
 assert.equal(result.status,'REFERENCE_VALID_FINANCE_REVIEW_REQUIRED');
 assert.equal(result.structurallyValid,true);
 assert.equal(result.readyForPosting,false);
 assert.equal(result.counts.materials,2);
 assert.equal(result.coverage.materials.mroContextErrors,0);
});
test('References to missing GL are blocked',()=>{
 const docs=bundle();docs.services.services[0].accounting.glResolution.transactionRoutes=[{event:'SERVICE_ACCEPTANCE',glCode:'66666666'}];
 const report=auditIntegratedMasterBundle(docs);
 assert.equal(report.structurallyValid,false);
 assert.ok(report.errors.some(x=>x.includes('missing GL 66666666')));
});
test('MRO expense rule cannot skip maintenance strategy',()=>{
 const docs=bundle();docs.materials.materials[0].accounting.glResolution.mode='catalogue_transaction';
 const report=auditIntegratedMasterBundle(docs);
 assert.equal(report.structurallyValid,false);
 assert.equal(report.coverage.materials.mroContextErrors,1);
});
test('Unmatched sector is not allowed on common catalogue entry',()=>{
 const docs=bundle();docs.assets.assetClasses[0].industryCodes=['IND-R'];
 assert.equal(auditIntegratedMasterBundle(docs).structurallyValid,false);
});
test('Strict activation fails while Finance sign-off is pending',()=>{
 const report=auditIntegratedMasterBundle(bundle(),{strict:true});
 assert.equal(report.readyForPosting,false);
 assert.equal(report.status,'FAILED');
 assert.ok(report.errors.some(x=>x.includes('Finance approval required')));
});
