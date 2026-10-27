import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogueFinanceSummary,catalogueFinanceDetail,catalogueFinanceErrors} from '../../backend/catalogueFinanceView.ts';

test('Financial metadata retains MRO context, true/false flags and GL routes',()=>{
 const x={
  code:'MAT-005-S001-F001-N001',
  accounting:{catalogueClassification:{majorBranch:'MRO',storesClassCode:'ESP',storesClassName:'Engineering Spare Parts'},
   glResolution:{mappingStatus:'reference_proposed',mode:'work_order_context',maintenanceStrategyRequiredForConsumption:true,
   transactionRoutes:[{event:'inventoryReceipt',glCode:'10305020',glName:'MRO Spare Parts - General',status:'reference_proposed',systemDerived:true}]}}
 };
 const sum=catalogueFinanceSummary(x);
 assert.equal(sum.majorBranch,'MRO');assert.equal(sum.primaryGlCode,'10305020');
 const detail=catalogueFinanceDetail(x);
 assert.equal(detail.routes.length,1);
 assert.equal(detail.determinationMode,'work_order_context');
 assert.equal(detail.usedInProcurement,null,'Missing eligibility must never masquerade as enabled');
 assert.deepEqual(catalogueFinanceErrors('materials',[x],true),[]);
});

test('Unapproved financial reference cannot be procurement-enabled',()=>{
 const gl={code:'10304080',usedInProcurement:true,usedInBudget:false,usedInProcurementPosting:false,
 pendingFinanceApproval:true,accountDetermination:{mappingStatus:'finance_review_required'}};
 assert.match(catalogueFinanceErrors('gl_accounts',[gl],true).join(' '),/cannot be procurement enabled/);
});
test('Malformed integrated catalogue is blocked, legacy catalogues remain readable',()=>{
 const x={code:'S-1',accounting:{suggestedAccounts:{purchasedServiceExpense:'61901010'}}};
 assert.deepEqual(catalogueFinanceErrors('services',[x],false),[]);
 assert.match(catalogueFinanceErrors('services',[x],true).join(' '),/routes\/status missing/);
});
test('Class explorer exposes the financial summary and full routing details',async()=>{
 const fs=await import('node:fs');
 const view=fs.readFileSync('src/components/AssetDictionaryBrowser.tsx','utf8');
 assert.match(view,/Financial classification &amp; GL determination/);
 assert.match(view,/Applicable GL routes/);
 assert.match(view,/usedInProcurement/);
 assert.match(view,/majorBranch/);
});

test('industry classification fields survive the financial explorer contract',()=>{
 const source={code:'X1',industryScope:'INDUSTRY_SPECIFIC',industryCodes:['IND-Q'],accounting:{glResolution:{mappingStatus:'reference_proposed',transactionRoutes:[{event:'purchase',glCode:'61901130'}]}}};
 const result=catalogueFinanceSummary(source);
 assert.equal(result.industryScope,'INDUSTRY_SPECIFIC');
 assert.deepEqual(result.industryCodes,['IND-Q']);
 assert.deepEqual(catalogueFinanceErrors('services',[source],true),[]);
 const invalid={...source,industryCodes:[]};
 assert.match(catalogueFinanceErrors('services',[invalid],true).join(' '),/industry codes/);
});

test('new industry-integrated catalogue imports require classifications and reject unknown codes',()=>{
 const valid={code:'S-1',industryScope:'COMMON',industryCodes:[],accounting:{glResolution:{mappingStatus:'reference_proposed',transactionRoutes:[{event:'SERVICE_ACCEPTANCE',glCode:'61901010'}]}}};
 assert.deepEqual(catalogueFinanceErrors('services',[valid],true,true),[]);
 const missing={...valid};delete missing.industryScope;
 assert.match(catalogueFinanceErrors('services',[missing],true,true).join(' '),/scope required/);
 const fake={...valid,industryScope:'INDUSTRY_SPECIFIC',industryCodes:['IND-R-999']};
 assert.match(catalogueFinanceErrors('services',[fake],true,true).join(' '),/valid industry codes/);
 const badCommon={...valid,industryCodes:['IND-R']};
 assert.match(catalogueFinanceErrors('services',[badCommon],true,true).join(' '),/cannot restrict industries/);
});

test('Transaction-audited master imports reject bogus handlers and refuse posting activation',()=>{
 const valid={code:'T',industryScope:'COMMON',industryCodes:[],accounting:{
  glResolution:{mappingStatus:'reference_proposed',transactionRoutes:[{
   event:'SERVICE_ACCEPTANCE',glCode:'61901010',runtimeTransactionBinding:{
    memsPostingEvents:['SVC_ACCEPT'],postingIntegrationState:'LIVE',
    postingPermission:'NO_NEW_POSTING_AUTHORITY',activatedByThisReferenceFile:false
   }
  }]}
 }};
 assert.deepEqual(catalogueFinanceErrors('services',[valid],true,true,true),[]);
 const altered=structuredClone(valid);altered.accounting.glResolution.transactionRoutes[0].runtimeTransactionBinding.memsPostingEvents=['GI_WO'];
 assert.match(catalogueFinanceErrors('services',[altered],true,true,true).join(' '),/crosswalk mismatch/);
 const unauthorized=structuredClone(valid);unauthorized.accounting.glResolution.transactionRoutes[0].runtimeTransactionBinding.activatedByThisReferenceFile=true;
 assert.match(catalogueFinanceErrors('services',[unauthorized],true,true,true).join(' '),/cannot authorise/);
 const missing=structuredClone(valid);missing.accounting.glResolution.transactionRoutes[0].event='NEVER_DEFINED';
 assert.match(catalogueFinanceErrors('services',[missing],true,true,true).join(' '),/unknown master-to-runtime/);
});
