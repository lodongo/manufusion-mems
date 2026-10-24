import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 calculateAllocation,allocationIsEffective,pendingCounterparties,
 validateAllocationPolicy,type AllocationPolicy,type AllocationReferences,
} from './corporateAllocation';
const references:AllocationReferences={
 legalEntities:[{id:'EA',code:'EA',name:'A'},{id:'EB',code:'EB',name:'B'}],
 costCenters:[{id:'CA',legalEntityId:'EA',name:'A CC',code:'CA'},
 {id:'CB',legalEntityId:'EB',name:'B CC',code:'CB'}],
 functions:[{code:'ENG',name:'Engineering'}],
};
const pool=():AllocationPolicy=>({
 id:'pool1',code:'ENG_SHARE',name:'Group Engineering',
 providerLegalEntityId:'EA',sourceCostCenterId:'CA',
 functionCode:'ENG',costNature:'SHARED_SERVICE',basis:'FIXED_PCT',
 beneficiaries:[
  {legalEntityId:'EA',costCenterId:'CA',fixedPercent:20,serviceAgreementRef:'',benefitEvidence:''},
  {legalEntityId:'EB',costCenterId:'CB',fixedPercent:80,serviceAgreementRef:'SLA-01',benefitEvidence:'Plant engineering work logs'},
 ],
 glAccountCodes:[],currency:'KES',annualCeilingMinor:5000000,
 effectiveFrom:'2026-11-01',effectiveTo:'2027-10-31',
 purpose:'Allocate Group Engineering costs to benefiting legal entities',
 driverEvidencePolicy:'',taxPolicyReference:'',
 pricingPolicy:'AT_COST',status:'awaiting_counterparties',version:1,
 approvalRef:'FCR00000001',approvedBy:'userA',approvedAt:'2026-10-24T00:00:00Z',confirmations:{},
});
test('P3 fixed shares preserve every integer minor unit of total cost',()=>{
 const p=validateAllocationPolicy(pool(),references);
 const r=calculateAllocation(p,1000001);
 assert.equal(r.allocatedMinor,1000001);
 assert.equal(r.rows.reduce((s,x)=>s+x.amountMinor,0),1000001);
 assert.equal(r.retainedMinor,200000);
 assert.equal(r.requiresIntercompanyProcessing,true);
});
test('P3 dynamic driver rules normalize hours and reconcile remainders deterministically',()=>{
 const p=pool();p.basis='TIMESHEET';p.driverEvidencePolicy='Signed site engineering timesheets';
 p.beneficiaries[0].fixedPercent=0;p.beneficiaries[1].fixedPercent=0;
 assert.doesNotThrow(()=>validateAllocationPolicy(p,references));
 const r=calculateAllocation(p,101,{'EA|CA':2,'EB|CB':1});
 assert.equal(r.allocatedMinor,101);
 assert.equal(r.rows.find(x=>x.legalEntityId==='EA')?.amountMinor,67);
 assert.equal(r.rows.find(x=>x.legalEntityId==='EB')?.amountMinor,34);
 assert.throws(()=>calculateAllocation(p,101,{'EA|CA':0,'EB|CB':0}),/greater than zero/);
});
test('P3 cannot cross-charge shareholder activities and mixed pools',()=>{
 const p=pool();p.costNature='SHAREHOLDER';
 assert.throws(()=>validateAllocationPolicy(p,references),/cannot be recharged/);
 p.costNature='MIXED';
 assert.throws(()=>validateAllocationPolicy(p,references),/distinct evidenced cost pools/);
});
test('P3 requires evidence and valid cost centre, agreement and pricing',()=>{
 const p=pool();p.beneficiaries[1].serviceAgreementRef='';
 assert.throws(()=>validateAllocationPolicy(p,references),/service agreement/);
 p.beneficiaries[1].serviceAgreementRef='SLA-01';p.beneficiaries[1].costCenterId='CA';
 assert.throws(()=>validateAllocationPolicy(p,references),/does not belong/);
 p.beneficiaries[1].costCenterId='CB';p.pricingPolicy='CONTRACT';
 assert.throws(()=>validateAllocationPolicy(p,references),/transfer-pricing/);
});
test('P3 bilateral signatures needed for effective policy even after provider approval',()=>{
 const p=pool();
 assert.deepEqual(pendingCounterparties(p),['EB']);
 p.status='approved_policy';
 assert.equal(allocationIsEffective(p,'2027-01-01'),false);
 p.confirmations={EB:{approvedBy:'userB',approvedAt:'2026-11-01',approvalRef:'FCR00000002'}};
 assert.equal(allocationIsEffective(p,'2027-01-01'),true);
 assert.equal(allocationIsEffective(p,'2027-11-01'),false);
});
