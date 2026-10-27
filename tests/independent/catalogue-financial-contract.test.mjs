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
