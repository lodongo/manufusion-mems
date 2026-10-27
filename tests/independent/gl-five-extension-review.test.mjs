import test from 'node:test';
import assert from 'node:assert/strict';
import {INVENTORY_EXTENSION_GROUPS,auditFiveGlExtensions,prepareFiveGlReferenceReview,
 EXCEPTION_REFERENCE_STATUS} from '../../src/lib/glExceptionBundleReview.ts';

const VERSION='finance-v3.1-reviewed-draft';
const bundleId='BUNDLE-FIVE';
const finance=()=>({catalogueRelease:'DRAFT_FINANCE_REVIEW',notAuthorizedForPosting:true,
  mappingReviewRequired:true,masterBundleId:bundleId,referenceGLVersion:VERSION});
function fixture(){
 const accounts=INVENTORY_EXTENSION_GROUPS.map(g=>({code:g.code,name:g.name,groupCode:g.code.slice(0,5),
  normalBalance:'Debit',accountType:'Balance sheet',postingMode:'Automatic - inventory movements and valuation',
  pendingFinanceApproval:true,usedInProcurement:false,usedInBudget:false,usedInProcurementPosting:false,
  accountDetermination:{mappingStatus:'finance_review_required'}}));
 const materials=[];
 for(const g of INVENTORY_EXTENSION_GROUPS)for(let n=1;n<=g.count;n++){
  materials.push({code:g.category+'-'+g.code+'-'+n,categoryCode:g.category,
   accounting:{
    suggestedAccounts:{inventoryReceipt:g.code},
    catalogueClassification:{majorBranch:'NON_MRO'},
    glResolution:{mappingStatus:'finance_review_required',mode:'catalogue_transaction',postingEnabled:false,
      transactionRoutes:[{event:'GOODS_RECEIPT',accountRole:'inventoryReceipt',glCode:g.code,glName:g.name,
        status:'finance_review_required',postingActive:false,proposedAccountExtension:true},
        {event:'STOCK_ISSUE',accountRole:'inventoryConsumption',glCode:'50101010',status:'reference_proposed',postingActive:false}]}
   }
  });
 }
 return {gl:{version:VERSION,financialIntegration:finance(),accounts},
  materials:{financialIntegration:finance(),materials}};
}
test('All 439 proposed material receipt references group deterministically under five GL additions',()=>{
 const f=fixture(),report=auditFiveGlExtensions(f.gl,f.materials);
 assert.equal(report.eligible,true,JSON.stringify(report.errors));
 assert.equal(report.affectedMaterialCount,439);
 assert.deepEqual(report.byAccount.map(x=>x.actual),[105,128,197,6,3]);
 assert.equal(report.byAccount.length,5);
});
test('Recorded batch reference review does not activate Finance masters or individual postings',()=>{
 const original=fixture(),review=prepareFiveGlReferenceReview(original.gl,original.materials,'Finance reviewer','Reference GL identity and warehouse valuation checked');
 assert.equal(review.summary.affectedMaterialCount,439);
 assert.equal(review.gl.financialIntegration.catalogueRelease,'DRAFT_FINANCE_REVIEW');
 assert.equal(review.gl.financialIntegration.notAuthorizedForPosting,true);
 assert.equal(review.materials.financialIntegration.catalogueRelease,'DRAFT_FINANCE_REVIEW');
 assert.equal(review.materials.financialIntegration.notAuthorizedForPosting,true);
 assert.equal(review.gl.accounts.every(x=>x.pendingFinanceApproval===true&&x.usedInProcurementPosting===false),true);
 assert.equal(review.gl.accounts.every(x=>x.accountDetermination.mappingStatus===EXCEPTION_REFERENCE_STATUS),true);
 assert.equal(review.materials.materials.every(x=>x.accounting.glResolution.mappingStatus===EXCEPTION_REFERENCE_STATUS),true);
 assert.equal(review.materials.materials.every(x=>x.accounting.glResolution.postingEnabled===false&&x.accounting.glResolution.transactionRoutes.every(r=>r.postingActive===false)),true);
 assert.equal(original.materials.materials[0].accounting.glResolution.mappingStatus,'finance_review_required','Original source remains immutable');
});
test('Missing or changed inventory GL prevents approval-like reference review',()=>{
 const f=fixture();f.gl.accounts.shift();
 const res=auditFiveGlExtensions(f.gl,f.materials);
 assert.equal(res.eligible,false);
 assert.ok(res.errors.some(x=>x.includes('proposed GL account is missing')));
 assert.throws(()=>prepareFiveGlReferenceReview(f.gl,f.materials,'Reviewer','Reference check complete'),/proposed GL account is missing/);
});
test('Wrong classification of technical category and expense route are both rejected',()=>{
 const f=fixture();
 f.materials.materials[0].categoryCode='MAT-005';
 f.materials.materials[1].accounting.glResolution.transactionRoutes[1].postingActive=true;
 const res=auditFiveGlExtensions(f.gl,f.materials);
 assert.equal(res.eligible,false);
 assert.ok(res.errors.some(x=>x.includes('category')));
 assert.ok(res.errors.some(x=>x.includes('enabled for posting')));
});
test('An unapproved GL cannot be enabled in procurement or posting',()=>{
 const f=fixture();f.gl.accounts[0].usedInProcurement=true;
 const res=auditFiveGlExtensions(f.gl,f.materials);
 assert.equal(res.eligible,false);
 assert.ok(res.errors.some(x=>x.includes('enabled for selection/posting')));
});
test('Bundle mismatch and unilateral published status cannot bypass the draft review gate',()=>{
 const f=fixture();f.gl.financialIntegration.masterBundleId='DIFFERENT';
 f.materials.financialIntegration.catalogueRelease='APPROVED';
 const res=auditFiveGlExtensions(f.gl,f.materials);
 assert.equal(res.eligible,false);
 assert.ok(res.errors.some(x=>x.includes('same non-empty')));
 assert.ok(res.errors.some(x=>x.includes('Finance-review drafts only')));
});
test('Work-order consumption classification cannot become static during reference review',()=>{
 const f=fixture();
 f.materials.materials[0].accounting.catalogueClassification.majorBranch='MRO';
 f.materials.materials[0].accounting.glResolution.mode='catalogue_transaction';
 assert.match(auditFiveGlExtensions(f.gl,f.materials).errors.join(' '),/work-order context driven/);
 f.materials.materials[0].accounting.glResolution.mode='work_order_context';
 f.materials.materials[0].accounting.glResolution.maintenanceStrategyRequiredForConsumption=true;
 assert.equal(auditFiveGlExtensions(f.gl,f.materials).eligible,true);
});
test('Reviewer acknowledgement is mandatory and never creates silent auto approval',()=>{
 const f=fixture();
 assert.throws(()=>prepareFiveGlReferenceReview(f.gl,f.materials,'','Reason long enough for audit'),/reviewer reference/);
 assert.throws(()=>prepareFiveGlReferenceReview(f.gl,f.materials,'ABC','short'),/review reason/);
});
test('MEMS Admin material catalogue has paired GL review and export controls',async()=>{
 const fs=await import('node:fs');
 const source=fs.readFileSync('src/components/CatalogueDraftPreview.tsx','utf8');
 assert.match(source,/Bulk review: 439 Materials mappings/);
 assert.match(source,/auditFiveGlExtensions\(companionGlMaster,fileData\)/);
 assert.match(source,/prepareFiveGlReferenceReview\(companionGlMaster,fileData,reviewerReference,reviewReason\)/);
 assert.match(source,/NOT_APPROVED\.json/);
});
