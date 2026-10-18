import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGovernedHandler, type RuntimeBinding } from './unifiedGovernanceRuntime';

const binding:RuntimeBinding={
  code:'MNT-WOR-AB12',handlerName:'org.mnt.wo.edit',permission:'MNT.WO.edit',
  module:'MNT',area:'WOR',classification:'permission_only',status:'active',
  configuredBy:'user-a',approvedBy:'user-b',handlerEvidenceId:'handler-test',
  scopeEvidenceId:'scope-test',sodEvidenceId:'sod-test',
};
const input={
  mode:'enforce' as const,code:binding.code,handlerName:binding.handlerName,
  routePermission:binding.permission,module:'MNT',area:'WOR',
  moduleEnabled:true,submoduleEnabled:true,effectivePermissionGranted:true,
  binding,
};
test('existing route handler behavior is unchanged before governance cutover',()=>{
  assert.equal(evaluateGovernedHandler({...input,mode:'inactive',binding:null}).allowed,true);
});
test('permission-only action requires exact route binding, authorizer, module and role',()=>{
  assert.equal(evaluateGovernedHandler(input).allowed,true);
  assert.equal(evaluateGovernedHandler({...input,binding:{...binding,approvedBy:'user-a'}}).allowed,false);
  assert.equal(evaluateGovernedHandler({...input,binding:{...binding,permission:'MNT.WO.approve'}}).allowed,false);
  assert.equal(evaluateGovernedHandler({...input,routePermission:null}).allowed,false);
  assert.equal(evaluateGovernedHandler({...input,effectivePermissionGranted:false}).allowed,false);
  assert.equal(evaluateGovernedHandler({...input,moduleEnabled:false}).allowed,false);
  assert.equal(evaluateGovernedHandler({...input,submoduleEnabled:false}).allowed,false);
  assert.equal(evaluateGovernedHandler({...input,binding:null}).allowed,false);
});
test('approval-required actions never trust requested approval flags without a server-side policy',()=>{
  const approval={...binding,classification:'approval_required' as const};
  assert.equal(evaluateGovernedHandler({...input,binding:approval}).allowed,false);
  assert.equal(evaluateGovernedHandler({...input,binding:approval,approvalSatisfied:true}).allowed,false);
});
