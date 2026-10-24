import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recognizeServiceCost} from './corporateServiceBudget';
import {type BudgetPlan} from './corporateBudget';
import {type SourceCommitment} from './corporateCommitment';

const budget=():BudgetPlan=>({
 legalEntityId:'LE001',fy:2027,currency:'KES',status:'approved',version:2,
 approvedBy:'CFO',approvedAt:'2026-11-01',approvalRef:'FCR00000009',
 lines:[
  {costCenterId:'CC-OPS',category:'OPEX',approvedMinor:100000,
   adjustmentsMinor:0,committedMinor:20000,actualMinor:0},
  {costCenterId:'CC-ENG',category:'OPEX',approvedMinor:100000,
   adjustmentsMinor:0,committedMinor:10000,actualMinor:0},
 ],
});
const committed=():SourceCommitment=>({
 sourceKind:'purchase_order',sourceKey:'PO00000012',sourceDocumentId:'PO00000012',
 version:1,status:'reserved',exceptionIds:[],lines:[
  {legalEntityId:'LE001',fy:2027,currency:'KES',costCenterId:'CC-OPS',
   category:'OPEX',amountMinor:20000},
  {legalEntityId:'LE001',fy:2027,currency:'KES',costCenterId:'CC-ENG',
   category:'OPEX',amountMinor:10000},
 ],
});
test('P5 service part-acceptance releases exactly posted amount and increases actual once',()=>{
 const p=budget(),s=committed();
 const t=recognizeServiceCost(p,s,'PO00000012_S1',[{costCenterId:'CC-OPS',amountMinor:4500}],false);
 assert.equal(t.actualMinor,4500);
 assert.equal(t.remainingMinor,25500);
 assert.equal(t.plan.lines[0].actualMinor,4500);
 assert.equal(t.plan.lines[0].committedMinor,15500);
 assert.equal(t.plan.lines[1].committedMinor,10000);
 assert.equal(t.source.lines.find(l=>l.costCenterId==='CC-OPS')?.amountMinor,15500);
 assert.equal(p.lines[0].actualMinor,0);
 assert.equal(s.version,1);
});
test('P5 complete service closes reservations without duplicating posted costs',()=>{
 const first=recognizeServiceCost(budget(),committed(),'PO00000012_S1',
  [{costCenterId:'CC-OPS',amountMinor:4500}],false);
 const finished=recognizeServiceCost(first.plan,first.source,'PO00000012_S2',[
  {costCenterId:'CC-OPS',amountMinor:15500},
  {costCenterId:'CC-ENG',amountMinor:10000},
 ],true);
 assert.equal(finished.plan.lines[0].committedMinor,0);
 assert.equal(finished.plan.lines[0].actualMinor,20000);
 assert.equal(finished.plan.lines[1].committedMinor,0);
 assert.equal(finished.plan.lines[1].actualMinor,10000);
 assert.equal(finished.source.status,'released');
 assert.deepEqual(finished.source.lines,[]);
 assert.equal(finished.remainingMinor,0);
 assert.equal(finished.source.version,3);
});
test('P5 incomplete service cannot mark fully accepted with exhausted reservation',()=>{
 const plan=budget(),src=committed();
 assert.throws(()=>recognizeServiceCost(plan,src,'PO00000012_S1',[
  {costCenterId:'CC-OPS',amountMinor:20000},
  {costCenterId:'CC-ENG',amountMinor:10000}],false),/still has unfinished service/);
});
test('P5 over-acceptance, foreign centres and duplication fail before any write',()=>{
 const p=budget(),s=committed();
 assert.throws(()=>recognizeServiceCost(p,s,'PO00000012_S1',
  [{costCenterId:'CC-OPS',amountMinor:22000}],false),/greater than/);
 assert.throws(()=>recognizeServiceCost(p,s,'PO00000012_S1',
  [{costCenterId:'CC-UNRELATED',amountMinor:1000}],false),/matching PO reservation/);
 const first=recognizeServiceCost(p,s,'PO00000012_S1',
  [{costCenterId:'CC-OPS',amountMinor:1000}],false);
 assert.throws(()=>recognizeServiceCost(first.plan,first.source,'PO00000012_S1',
  [{costCenterId:'CC-OPS',amountMinor:1000}],false),/already consumed/);
});
test('P5 no repeated acceptance after release and no negative or zero actual',()=>{
 const p=budget(),s=committed();
 assert.throws(()=>recognizeServiceCost(p,s,'PO00000012_S1',
  [{costCenterId:'CC-OPS',amountMinor:0}],false),/positive/);
 const done=recognizeServiceCost(p,s,'PO00000012_S1',
  [{costCenterId:'CC-OPS',amountMinor:5000}],true);
 assert.throws(()=>recognizeServiceCost(done.plan,done.source,'PO00000012_S2',
  [{costCenterId:'CC-OPS',amountMinor:5000}],true),/active PO reservation/);
});
