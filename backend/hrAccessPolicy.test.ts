import assert from 'node:assert/strict';
import test from 'node:test';
import { HR_POLICY, canApproveHrTransaction, canReadHrBasicProfile } from './hrAccessPolicy';

const actor = { tenantId: 'org-a', uid: 'u-manager', siteIds: ['site-1'], permissions: ['HRM.employee.site.read','HRM.manager.hierarchy.read'] };
const subject = { tenantId: 'org-a', employeeUid:'u-worker', siteId:'site-1', managerAncestorUids:['u-manager'] };

test('confirmed HR access policy is site / hierarchy / independent',()=>{
  assert.equal(HR_POLICY.hrAccessScope,'site');
  assert.equal(HR_POLICY.managerAccessScope,'manager_hierarchy');
  assert.equal(HR_POLICY.approvalAssignment,'independent');
});
test('HR site scope denies other sites and tenants',()=>{
  assert.equal(canReadHrBasicProfile(actor,subject,'site').allowed,true);
  assert.equal(canReadHrBasicProfile(actor,{...subject,siteId:'site-2'},'site').allowed,false);
  assert.equal(canReadHrBasicProfile(actor,{...subject,tenantId:'org-b'},'site').allowed,false);
});
test('manager can only see verified hierarchy with explicit permission',()=>{
  assert.equal(canReadHrBasicProfile(actor,subject,'manager_hierarchy').allowed,true);
  assert.equal(canReadHrBasicProfile(actor,{...subject,managerAncestorUids:[]},'manager_hierarchy').allowed,false);
  assert.equal(canReadHrBasicProfile({...actor,permissions:[]},subject,'manager_hierarchy').allowed,false);
});
test('independent approvals fail closed without complete prerequisites',()=>{
  const req={actorUid:'approver',requesterUid:'requester',assessorUid:'assessor',hasIndependentApproverRole:true,coaBound:true,workflowActive:true,permittedAmount:true,siteMatch:true};
  assert.equal(canApproveHrTransaction(req).allowed,true);
  assert.equal(canApproveHrTransaction({...req,actorUid:'requester'}).allowed,false);
  assert.equal(canApproveHrTransaction({...req,coaBound:false}).allowed,false);
  assert.equal(canApproveHrTransaction({...req,permittedAmount:false}).allowed,false);
  assert.equal(canApproveHrTransaction({...req,siteMatch:false}).allowed,false);
});
