import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 BUDGET_CLASSES,FUNDING_METHODS,moneyMinor,validateNewPlan,remainingMinor,
 applyApprovedRevision,applyApprovedTransfer,checkBudget,validateFundingAgreement,type BudgetPlan,type BudgetTransfer,
 type BudgetException,type FundingAgreement,
} from './corporateBudget';

const plan=():BudgetPlan=>({
 legalEntityId:'LE1',fy:2027,currency:'KES',status:'approved',version:1,
 approvalRef:'FCR00000001',approvedAt:'2026-10-24',approvedBy:'reviewer',
 lines:[
  {costCenterId:'CC1',category:'OPEX',approvedMinor:10000000,adjustmentsMinor:0,committedMinor:3000000,actualMinor:2000000},
  {costCenterId:'CC2',category:'OPEX',approvedMinor:2000000,adjustmentsMinor:0,committedMinor:0,actualMinor:0},
  {costCenterId:'CC1',category:'CAPEX',approvedMinor:3000000,adjustmentsMinor:0,committedMinor:0,actualMinor:0},
 ],
});
const transfer=():BudgetTransfer=>({
 legalEntityId:'LE1',fy:2027,currency:'KES',
 fromCostCenterId:'CC1',fromCategory:'OPEX',toCostCenterId:'CC2',toCategory:'OPEX',
 amountMinor:2000000,reason:'Approved budget reallocation for capital project',
});
const exception=():BudgetException=>({
 id:'FCR00000009',legalEntityId:'LE1',fy:2027,costCenterId:'CC1',
 category:'OPEX',maxExtraMinor:1000000,currency:'KES',
 sourceDocumentId:'PR-1234',expiresOn:'2027-07-31',reason:'Emergency breakdown',
 status:'approved',approvedAt:'2027-04-01',approvedBy:'reviewer',approvalRef:'FCR00000009',
});
test('P2 publishes organization-independent codified budget and funding categories',()=>{
 assert.deepEqual(BUDGET_CLASSES.map(x=>x.code),['OPEX','CAPEX','PAYROLL','PROJECT','SHARED','OTHER']);
 assert.deepEqual(FUNDING_METHODS.map(x=>x.code),['COR','ENT','REI','LOAN','EQU','CPOOL','HYB']);
});
test('P2 money conversion rejects negative/unsupported fractional minor units',()=>{
 assert.equal(moneyMinor(100.25),10025);
 assert.equal(moneyMinor(0.29),29);
 assert.equal(moneyMinor(0.57),57);
 assert.throws(()=>moneyMinor(-1));
 assert.throws(()=>moneyMinor(1.234));
});
test('P2 approves a budget only from new, unique, positive starting lines',()=>{
 const b=plan().lines.map(x=>({...x,committedMinor:0,actualMinor:0}));
 assert.equal(validateNewPlan(b).length,3);
 assert.throws(()=>validateNewPlan([...b,b[0]]),/Duplicate/);
 assert.throws(()=>validateNewPlan([{...b[0],approvedMinor:0}]),/positive/);
 assert.throws(()=>validateNewPlan([{...b[0],committedMinor:100}]),/Opening budgets/);
});
test('P2 same-entity approved transfers conserve total budget without GL',()=>{
 const p=plan(),t=transfer(),next=applyApprovedTransfer(p,t);
 assert.equal(next.version,2);
 assert.equal(next.lines.reduce((a,x)=>a+x.approvedMinor+x.adjustmentsMinor,0),
  p.lines.reduce((a,x)=>a+x.approvedMinor+x.adjustmentsMinor,0));
 assert.equal(remainingMinor(next.lines[0]),3000000);
 assert.equal(remainingMinor(next.lines[1]),4000000);
 assert.equal(p.lines[0].adjustmentsMinor,0);
});
test('P2 denies overdrawn, cross-entity, cross-year and no-op transfers',()=>{
 assert.throws(()=>applyApprovedTransfer(plan(),{...transfer(),amountMinor:5000001}),/Insufficient/);
 assert.throws(()=>applyApprovedTransfer(plan(),{...transfer(),legalEntityId:'LE2'}),/one approved/);
 assert.throws(()=>applyApprovedTransfer(plan(),{...transfer(),fy:2028}),/one approved/);
 assert.throws(()=>applyApprovedTransfer(plan(),{...transfer(),toCostCenterId:'CC1'}),/must differ/);
});
test('P2 budget availability blocks excessive spend unless a matching scoped exception exists',()=>{
 const p=plan();
 assert.equal(checkBudget(p,'CC1','OPEX',4500000).status,'within_budget');
 assert.equal(checkBudget(p,'CC1','OPEX',5500000).status,'requires_exception');
 assert.equal(checkBudget(p,'CC1','OPEX',5500000,exception(),'2027-05-01','PR-1234').status,'within_budget');
 assert.equal(checkBudget(p,'CC1','OPEX',5500000,exception(),'2027-08-01','PR-1234').status,'requires_exception');
 assert.equal(checkBudget(p,'CC1','OPEX',5500000,exception(),'2027-05-01','PR-9999').status,'requires_exception');
 assert.equal(checkBudget(p,'CC1','OPEX',5500000,{...exception(),maxExtraMinor:100000},'2027-05-01','PR-1234').status,'requires_exception');
 assert.equal(checkBudget(null,'CC1','OPEX',1).status,'no_approved_budget');
});
test('P2 funding requires valid dates, parties, method, ISO currency and an agreement',()=>{
 const ag:FundingAgreement={
  id:'a',providerLegalEntityId:'LE1',beneficiaryLegalEntityId:'LE2',
  method:'REI',currency:'KES',limitMinor:100000,
  agreementReference:'SLA-001',purpose:'Group IT services',
  effectiveFrom:'2026-11-01',effectiveTo:'2027-10-31',budgetReference:'FY27',
  settlementPolicy:'MONTHLY',status:'awaiting_counterparty',approvalRef:'',
  confirmedApprovalRef:'',approvedBy:'',confirmedBy:'',approvedAt:'',confirmedAt:'',
 };
 assert.doesNotThrow(()=>validateFundingAgreement(ag));
 assert.throws(()=>validateFundingAgreement({...ag,method:'BAD' as FundingAgreement['method']}),/Unknown/);
 assert.throws(()=>validateFundingAgreement({...ag,effectiveFrom:'2026-02-30'}),/date/);
 assert.throws(()=>validateFundingAgreement({...ag,beneficiaryLegalEntityId:''}),/required/);
});

test('P2 revision increases/new lines and preserves original appropriations',()=>{
 const p=plan();
 const r={legalEntityId:'LE1',fy:2027,currency:'KES',
  changes:[{costCenterId:'CC2',category:'OPEX' as const,deltaMinor:500000},
   {costCenterId:'CC2',category:'CAPEX' as const,deltaMinor:900000}],
  reason:'Approved supplementary appropriation by Finance committee'};
 const next=applyApprovedRevision(p,r);
 assert.equal(next.version,2);
 assert.equal(next.lines.length,4);
 assert.equal(next.lines.find(x=>x.costCenterId==='CC2'&&x.category==='OPEX')?.adjustmentsMinor,500000);
 assert.equal(next.lines.find(x=>x.costCenterId==='CC2'&&x.category==='CAPEX')?.approvedMinor,0);
 assert.equal(next.lines.find(x=>x.costCenterId==='CC2'&&x.category==='CAPEX')?.adjustmentsMinor,900000);
 assert.equal(p.lines.length,3);
});
test('P2 revision prevents reducing budget below existing commitments/actual costs',()=>{
 const r={legalEntityId:'LE1',fy:2027,currency:'KES',
  changes:[{costCenterId:'CC1',category:'OPEX' as const,deltaMinor:-5000001}],
  reason:'Proposed reduction'};
 assert.throws(()=>applyApprovedRevision(plan(),r),/cannot cut into/);
 assert.throws(()=>applyApprovedRevision(plan(),{...r,changes:[{costCenterId:'CC3',category:'OPEX' as const,deltaMinor:-1000}]}),/does not exist/);
 assert.throws(()=>applyApprovedRevision(plan(),{...r,legalEntityId:'LE2'}),/must match/);
});
