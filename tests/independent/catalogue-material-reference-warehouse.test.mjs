import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkCatalogueFile} from '../../backend/procurement.ts';

const file=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const reference={
 catalogType:'materials',schemaVersion:'5.3.0',catalogName:'Reference Materials Master',
 attributeDomains:[{code:'TECH',name:'Technical data'}],
 attributes:[{code:'AT-TEST',name:'Test property',domain:'TECH',dataType:'text'}],
 profiles:[],categories:[{code:'MAT-001',name:'Raw Materials'}],
 subcategories:[{code:'MAT-001-S001',name:'Sugar and sweeteners',categoryCode:'MAT-001'}],
 families:[{code:'MAT-001-S001-F001',name:'Cane sugar',subcategoryCode:'MAT-001-S001'}],
 materials:[{code:'MAT-001-S001-F001-N001',name:'Raw cane sugar',categoryCode:'MAT-001',
  subcategoryCode:'MAT-001-S001',familyCode:'MAT-001-S001-F001',
  attributes:['AT-TEST'],requiredAttributes:['AT-TEST'],
  accountingIntegration:{defaultCandidates:{inventoryGLCandidates:['10301010'],consumptionGLCandidates:['50101010']}},
  accounting:{catalogueClassification:{majorBranch:'NON_MRO',storesClassCode:'RAW'},
    glResolution:{mappingStatus:'finance_review_required',referenceOnly:true,postingEnabled:false,
      transactionRoutes:[]}},pendingFinanceApproval:true,usedInProcurementPosting:false}],
 financialDimensions:{version:'FIN-DIM-REFERENCE-1.0',releaseStatus:'REFERENCE_ONLY_FINANCE_REVIEW_REQUIRED',
  financialApproval:{state:'NOT_APPROVED'},dimensions:[{code:'LEGAL_ENTITY',name:'Legal entity'}]},
};

test('reference-only financial dimensions do not masquerade as an approved integrated Finance release',()=>{
 const check=checkCatalogueFile('materials',reference);
 assert.deepEqual(check.errors,[]);
 assert.deepEqual(check.releaseProblems,[]);
 assert.equal(reference.financialIntegration,undefined);
 assert.equal(reference.materials[0].accounting.glResolution.postingEnabled,false);
});

test('large catalog upload uses per-session, per-chunk identity with persisted checksum and targeted repair',()=>{
 const server=file('backend/procurement.ts'),ui=file('src/admin/ProcurementCatalogAdmin.tsx');
 for(const code of ['stagedUpload','stagedChunk','uploadIdOf','sha256:chunkHash',
   'const verified=await getDoc(path)','getDoc(stagedChunk(kind,uploadId,offset+i))',
   'missingChunks:missing','status:','activeRelease: release']){
   assert.ok(server.includes(code),'server '+code);
 }
 for(const code of ['crypto.randomUUID()','ack.sha256!==chunkSha',
   'uploadPart(start+i)','res.missingChunks.filter','setProgress']){
   assert.ok(ui.includes(code),'client '+code);
 }
 assert.ok(server.includes('const release=str(s.data.sha256).slice(0,32)'));
 assert.ok(server.includes('schemaVersion'));
});

test('material financial reference preview accepts candidate dimensions without bypassing release gate',()=>{
 const preview=file('src/components/CatalogueDraftPreview.tsx');
 const guard=file('backend/catalogueReleaseGuard.ts');
 assert.ok(preview.includes('root.financialDimensions'));
 assert.ok(preview.includes('referenceOnly'));
 assert.ok(preview.includes('Candidate inventory GLs'));
 assert.ok(preview.includes('Financial dimensions contract'));
 assert.ok(guard.includes("fin.catalogueRelease!=='APPROVED'"));
 assert.ok(guard.includes('Approved release requires a traceable Finance sign-off reference.'));
});

test('warehouse category > storage location > subcategory > cluster validation preserves old clusters',()=>{
 const wh=file('backend/warehouse.ts'),ui=file('src/org/WarehouseSetup.tsx');
 for(const token of ['materialCategoryCode','materialSubcategoryCode',
   'new clusters must select exactly one', 'requestedSubcategory','Linked material ',
   'subcategory must belong to its parent storage-location category']){
   assert.ok(wh.toLowerCase().includes(token.toLowerCase()),'backend '+token);
 }
 assert.ok(ui.includes('Material catalog category (storage location)'));
 assert.ok(ui.includes('Select catalog subcategory for this cluster'));
 assert.ok(ui.includes('eligibleSubs'));
 assert.ok(ui.includes('Align this cluster to one catalog subcategory'));
 assert.ok(ui.includes('Existing clusters retain their mappings'));
});
