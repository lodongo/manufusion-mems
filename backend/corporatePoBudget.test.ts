import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HttpError} from './core';
import {parsePoGatePolicy,verifyPoServicePilot,verifyPoGateApproval,poBudgetServerEnabled,type PoGatePolicy} from './corporatePoBudget';
import {validateGateIntent} from './corporatePoBudgetRoutes';

const policy=():PoGatePolicy=>({
 mode:'service_pilot',scope:'service_purchase_orders',legalEntityId:'LE001',category:'OPEX',
 valuation:'po_line_net',approvalRef:'FCR00000123',
 activationDate:'2026-11-01',signedOffBy:'controllerA',effectiveVersion:1,
});
test('P5 procurement budget gate defaults off; only governed, valid configuration enables it',()=>{
 assert.equal(parsePoGatePolicy(null),null);
 assert.equal(parsePoGatePolicy({mode:'off'}),null);
 assert.equal(parsePoGatePolicy(policy() as unknown as Record<string,unknown>)?.mode,'service_pilot');
 assert.throws(()=>parsePoGatePolicy({...policy(),approvalRef:'UNSIGNED'}),HttpError);
 assert.throws(()=>parsePoGatePolicy({...policy(),activationDate:'2026-02-30'}),HttpError);
 assert.throws(()=>parsePoGatePolicy({...policy(),scope:'all_purchase_orders'}),HttpError);
});
test('P5 service pilot verifies line value and refuses unrelated PO types',()=>{
 const p=policy();
 assert.doesNotThrow(()=>verifyPoServicePilot([
  {costCenterId:'CC1',type:'service',total:200},{costCenterId:'CC2',type:'service',total:100},
 ],300,p));
 assert.throws(()=>verifyPoServicePilot([
  {costCenterId:'CC1',type:'material',total:300}],300,p),/cannot approve materials/);
 assert.throws(()=>verifyPoServicePilot([
  {costCenterId:'',type:'service',total:300}],300,p),/unassigned cost centres/);
 assert.throws(()=>verifyPoServicePilot([
  {costCenterId:'CC1',type:'service',total:250}],300,p),/differs/);
});

test('P5 rollout requires explicit opt-in plus a nonproduction development project',()=>{
 assert.equal(poBudgetServerEnabled({MEMS_FIREBASE_PROJECT_ID:'mems-dev-1234',MEMS_PO_BUDGET_PILOT_ENABLED:'true'}),true);
 assert.equal(poBudgetServerEnabled({MEMS_FIREBASE_PROJECT_ID:'mems-dev-1234'}),false);
 assert.equal(poBudgetServerEnabled({MEMS_FIREBASE_PROJECT_ID:'mems-production',MEMS_PO_BUDGET_PILOT_ENABLED:'true'}),false);
 assert.equal(poBudgetServerEnabled({MEMS_FIREBASE_PROJECT_ID:'mems-dev-production',MEMS_PO_BUDGET_PILOT_ENABLED:'true'}),false);
 assert.equal(poBudgetServerEnabled({MEMS_FIREBASE_PROJECT_ID:'mems2026',MEMS_PO_BUDGET_PILOT_ENABLED:'true'}),false);
});
test('P5 Finance activation verifies approved FCR identity, entity, maker/checker and immutable intended mode',()=>{
 const p=policy();
 const fcr={
  id:p.approvalRef,type:'corp.po.budget.gate',status:'approved',
  leId:p.legalEntityId,makerUid:'financeMaker',decidedBy:p.signedOffBy,
  payload:{mode:p.mode,legalEntityId:p.legalEntityId,category:p.category,activationDate:p.activationDate},
  result:{mode:p.mode,legalEntityId:p.legalEntityId},
 };
 assert.doesNotThrow(()=>verifyPoGateApproval(p,fcr));
 assert.throws(()=>verifyPoGateApproval(p,{...fcr,status:'pending'}),HttpError);
 assert.throws(()=>verifyPoGateApproval(p,{...fcr,id:'FCR99999999'}),HttpError);
 assert.throws(()=>verifyPoGateApproval(p,{...fcr,makerUid:p.signedOffBy}),HttpError);
 assert.throws(()=>verifyPoGateApproval(p,{...fcr,payload:{...fcr.payload,category:'CAPEX'}}),HttpError);
 assert.throws(()=>verifyPoGateApproval(p,{...fcr,result:{...fcr.result,mode:'off'}}),HttpError);
});
test('P5 activation proposals are legal-entity scoped, OPEX only and version checked',()=>{
 const input={
  mode:'service_pilot',legalEntityId:'LE001',category:'OPEX',
  activationDate:'2026-11-01',expectedVersion:0,
  reason:'Validate controlled service spend in development',
 };
 assert.equal(validateGateIntent(input).mode,'service_pilot');
 assert.throws(()=>validateGateIntent({...input,category:'CAPEX'}),/Only the OPEX/);
 assert.throws(()=>validateGateIntent({...input,expectedVersion:-1}),/configuration revision/);
 assert.throws(()=>validateGateIntent({...input,activationDate:'2026-02-30'}),/valid activation date/);
 assert.throws(()=>validateGateIntent({...input,reason:'short'}),/ten characters/);
});
