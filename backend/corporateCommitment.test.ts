import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transitionCommitment,type CommitmentLine,type SourceCommitment} from './corporateCommitment';
import {type BudgetPlan,type BudgetException} from './corporateBudget';

const plans=():BudgetPlan[]=>[{
 legalEntityId:'EA',fy:2027,currency:'KES',status:'approved',version:1,
 approvedBy:'CFO',approvedAt:'2026-10-24',approvalRef:'FCR00000001',
 lines:[{costCenterId:'CA',category:'OPEX',approvedMinor:100000,
  committedMinor:0,actualMinor:0,adjustmentsMinor:0}],
}];
const line=(v:number):CommitmentLine=>({
 legalEntityId:'EA',fy:2027,currency:'KES',costCenterId:'CA',category:'OPEX',amountMinor:v,
});
const source=(version:number,amount:number):SourceCommitment=>({
 sourceKind:'purchase_order',sourceKey:'PO-ROOT-1',sourceDocumentId:'PO000001',
 version,status:'reserved',lines:[line(amount)],exceptionIds:[],
});
const exception=():BudgetException=>({
 id:'FCR00000021',legalEntityId:'EA',fy:2027,costCenterId:'CA',category:'OPEX',
 currency:'KES',maxExtraMinor:10000,sourceDocumentId:'PO000001',
 expiresOn:'2027-09-30',status:'approved',reason:'Unplanned critical breakdown',
 approvedBy:'CFO',approvedAt:'2027-01-01',approvalRef:'FCR00000021',
});
test('P2.5 reserves across all source lines as a single plan transition',()=>{
 const tx=transitionCommitment(plans(),null,source(1,30000),[], '2027-02-01');
 assert.equal(tx.plans[0].lines[0].committedMinor,30000);
 assert.equal(tx.plans[0].version,2);
 assert.deepEqual(tx.changedPlans,['EA|2027']);
});
test('P2.5 concurrent source demands cannot both pass when plan snapshot refreshed',()=>{
 const first=transitionCommitment(plans(),null,source(1,90000),[], '2027-02-01');
 assert.throws(()=>transitionCommitment(first.plans,null,{
  ...source(1,20000),sourceKey:'PO-ROOT-2',sourceDocumentId:'PO000002'
 },[],'2027-02-01'),/Budget blocked/);
});
test('P2.5 amendment moves old reservation, rather than double-reserving',()=>{
 const first=transitionCommitment(plans(),null,source(1,30000),[], '2027-02-01');
 const next=transitionCommitment(first.plans,first.source,source(2,40000),[],'2027-02-02');
 assert.equal(next.plans[0].lines[0].committedMinor,40000);
});
test('P2.5 cancellation releases reserved budget and checks original source',()=>{
 const first=transitionCommitment(plans(),null,source(1,30000),[], '2027-02-01');
 const released=transitionCommitment(first.plans,first.source,{
  ...first.source,version:2,status:'released',lines:[],
 },[],'2027-02-01');
 assert.equal(released.plans[0].lines[0].committedMinor,0);
 assert.throws(()=>transitionCommitment(first.plans,first.source,{
  ...source(2,1000),sourceDocumentId:'OTHER_DOC',
 },[],'2027-02-01'),/cannot be reassigned/);
});
test('P2.5 approved exception is narrow to source, expiry, entity and cap',()=>{
 const p=plans(),next={...source(1,105000),exceptionIds:['FCR00000021']};
 assert.equal(transitionCommitment(p,null,next,[exception()],'2027-02-01').plans[0].lines[0].committedMinor,105000);
 assert.throws(()=>transitionCommitment(p,null,next,[exception()],'2027-10-01'),/Budget blocked/);
 assert.throws(()=>transitionCommitment(p,null,{...next,sourceDocumentId:'PO_OTHER'},[exception()],'2027-02-01'),/Budget blocked/);
 assert.throws(()=>transitionCommitment(p,null,{...next,lines:[line(120000)]},[exception()],'2027-02-01'),/Budget blocked/);
});
test('P2.5 stale updates and same-version mutation refused',()=>{
 const initial=transitionCommitment(plans(),null,source(2,40000),[], '2027-02-01');
 assert.throws(()=>transitionCommitment(initial.plans,initial.source,source(1,40000),[],'2027-02-01'),/Stale/);
 assert.throws(()=>transitionCommitment(initial.plans,initial.source,source(2,50000),[],'2027-02-01'),/newer source version/);
});
