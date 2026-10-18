import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateTransactionAccess, type AccessDecisionInput } from './transactionAccessBoundary';

const valid = (): AccessDecisionInput => ({
  code:'PRC-PUR-AP',moduleEnabled:true,submoduleEnabled:true,
  implementedHandler:true,registryVerified:true,actionPermissionGranted:true,
  scopeAuthorized:true,sodPermitted:true,governanceClass:'approval_required',
  approvedPolicy:true,approvalSatisfied:true,
});
test('verified, independently approved action is eligible',()=>{
  assert.equal(evaluateTransactionAccess(valid()).allowed,true);
});
for (const key of ['moduleEnabled','submoduleEnabled','implementedHandler','registryVerified','actionPermissionGranted','scopeAuthorized','sodPermitted','approvedPolicy','approvalSatisfied'] as const) {
  test('fails closed if '+key+' is false',()=>{
    const input={...valid(),[key]:false};
    assert.equal(evaluateTransactionAccess(input).allowed,false);
  });
}
test('unconfigured governance is denied',()=>assert.equal(evaluateTransactionAccess({...valid(),governanceClass:'unconfigured'}).allowed,false));
test('permission-only actions do not require workflow approval',()=>assert.equal(evaluateTransactionAccess({...valid(),governanceClass:'permission_only',approvedPolicy:false,approvalSatisfied:false}).allowed,true));
test('malformed transaction codes are denied',()=>assert.equal(evaluateTransactionAccess({...valid(),code:'PRC.*'}).allowed,false));
