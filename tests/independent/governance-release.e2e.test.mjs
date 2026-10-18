/**
 * In-memory, cross-module release simulation. This does not claim a live
 * Firestore/Cloud Run end-to-end test; it exercises the shared contracts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {recordWiredRoutes,wiredTransactionInventory} from '../../backend/transactionRuntime.ts';
import {evaluateCutoverCoverage} from '../../backend/governanceCutoverCoverage.ts';
import {applyApprovalDecision,validateApprovalEvidence,transactionPayloadHash} from '../../backend/unifiedApprovalProof.ts';
import {evaluateGovernedHandler} from '../../backend/unifiedGovernanceRuntime.ts';

const withOrg=(name,permission)=>Object.assign(async()=>({ok:true}),{
  governanceMetadata:{name,permission,kind:'organization'},
});
test('cross-module simulated cutover blocks missing bindings, verifies quorum and protects future handlers',()=>{
  recordWiredRoutes({
    'POST /api/org/mnt/wo/close':[withOrg('org.mnt.wo.close','MNT.WO.close')],
    'POST /api/org/prc/po/post':[withOrg('org.prc.po.post','PRC.po.post')],
    'POST /api/org/inv/stock/adjust':[withOrg('org.inv.stock.adjust','INV_ST.adjust')],
  });
  const routes=wiredTransactionInventory();
  assert.equal(routes.length,3);
  const bindings=new Map(routes.map(r=>[r.code,{
    code:r.code,handlerName:r.name,permission:r.permission,module:r.module,area:r.area,
    status:'active',configuredBy:'admin-a',approvedBy:'admin-b',
    handlerEvidenceId:'verified-handler',scopeEvidenceId:'verified-scope',
    sodEvidenceId:'verified-separation',classification:r.module==='PRC'?'approval_required':'permission_only',
    version:1,
  }]));
  const policy=new Map();
  assert.equal(evaluateCutoverCoverage(routes,bindings,policy).canActivate,false);
  const purchase=routes.find(r=>r.module==='PRC');
  policy.set(purchase.code,{status:'active',configuredBy:'admin-a',approvedBy:'admin-b',
    rules:[{id:'fin',stream:'FINANCE',type:'minimum_level',level:1,mandatory:true,enabled:true}],
    approversByLevel:{'FINANCE:1':['approver-1','approver-2']},version:1});
  assert.equal(evaluateCutoverCoverage(routes,bindings,policy).canActivate,true);
  const amount={amount:150000,currency:'KES',poId:'PO-001'};
  const e={
    orgId:'org-a',code:purchase.code,handlerName:purchase.name,requestedBy:'creator',
    payloadHash:transactionPayloadHash(amount),status:'pending',
    steps:[{stream:'FINANCE',level:1,quorum:{mode:'all'},eligibleUserIds:['approver-1','approver-2']}],
    votes:[],
  };
  const first=applyApprovalDecision(e,'approver-1','approve','2026-10-18T09:00:00Z');
  assert.equal(first.status,'pending');
  const second=applyApprovalDecision({...e,votes:first.votes},'approver-2','approve','2026-10-18T09:01:00Z');
  assert.equal(second.status,'approved');
  const approved={...e,status:'approved',votes:second.votes};
  assert.deepEqual(validateApprovalEvidence(approved,{
    orgId:'org-a',code:purchase.code,handlerName:purchase.name,
    requesterUid:'creator',payload:amount,
  }),[]);
  assert.ok(validateApprovalEvidence(approved,{
    orgId:'org-a',code:purchase.code,handlerName:purchase.name,
    requesterUid:'creator',payload:{...amount,amount:200000},
  }).length);
  const access={
    mode:'enforce',code:purchase.code,handlerName:purchase.name,routePermission:purchase.permission,
    module:purchase.module,area:purchase.area,moduleEnabled:true,submoduleEnabled:true,
    effectivePermissionGranted:true,binding:bindings.get(purchase.code),approvalSatisfied:true,
  };
  assert.equal(evaluateGovernedHandler(access).allowed,true);
  assert.equal(evaluateGovernedHandler({...access,approvalSatisfied:false}).allowed,false);
  assert.equal(evaluateGovernedHandler({...access,moduleEnabled:false}).allowed,false);
  assert.equal(evaluateGovernedHandler({...access,effectivePermissionGranted:false}).allowed,false);
  recordWiredRoutes({
    'POST /api/org/mnt/wo/close':[withOrg('org.mnt.wo.close','MNT.WO.close')],
    'POST /api/org/prc/po/post':[withOrg('org.prc.po.post','PRC.po.post')],
    'POST /api/org/inv/stock/adjust':[withOrg('org.inv.stock.adjust','INV_ST.adjust')],
    'POST /api/org/pln/schedule/submit':[withOrg('org.pln.schedule.submit','PLN.submit')],
  });
  assert.equal(evaluateCutoverCoverage(wiredTransactionInventory(),bindings,policy).canActivate,false);
});
