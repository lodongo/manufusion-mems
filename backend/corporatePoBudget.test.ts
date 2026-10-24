import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HttpError} from './core';
import {parsePoGatePolicy,verifyPoServicePilot,type PoGatePolicy} from './corporatePoBudget';

const policy=():PoGatePolicy=>({
 mode:'service_pilot',scope:'service_purchase_orders',category:'OPEX',
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
