import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultMaintenanceGovernance,validateMaintenanceGovernance,approvalRequirement} from './maintenanceGovernancePolicy';
test('draft defaults have all three optional approvals disabled',()=>{
 const p=validateMaintenanceGovernance(defaultMaintenanceGovernance());
 for(const r of [p.workRequest,p.workOrder,p.technicalClosure])assert.equal(approvalRequirement(r,{}),'not_required');
});
test('unconditional, all and any rules are distinct; missing facts do not bypass approval',()=>{
 const p=defaultMaintenanceGovernance();p.workOrder.enabled=true;
 assert.equal(approvalRequirement(p.workOrder,{}),'required');
 p.workOrder.conditions=[{field:'estimatedCost',op:'gte',value:5000},{field:'requiresSpares',op:'eq',value:true}];
 const r=validateMaintenanceGovernance(p).workOrder;
 assert.equal(approvalRequirement(r,{estimatedCost:7000,requiresSpares:true}),'required');
 assert.equal(approvalRequirement(r,{estimatedCost:7000}),'undetermined');
 assert.equal(approvalRequirement(r,{estimatedCost:1000}),'not_required');
 assert.equal(approvalRequirement({...r,match:'any'},{estimatedCost:7000}),'required');
 assert.equal(approvalRequirement({...r,match:'any'},{estimatedCost:1000}),'undetermined');
});
test('invalid stage and conditions rejected',()=>{
 const p=defaultMaintenanceGovernance();
 assert.throws(()=>validateMaintenanceGovernance({...p,workOrderStage:'after_close'}));
 assert.throws(()=>validateMaintenanceGovernance({...p,workOrder:{enabled:true,match:'all',conditions:[{field:'estimatedCost',op:'gte',value:'5000'}]}}));
});

import {maintenanceActivationBlockers,maintenanceAssessmentApprovalRequired} from './maintenanceGovernancePolicy';
import {maintenanceAssessmentReady} from './maintenanceAssessmentReview';
test('legacy records keep independent approval; all-off snapshot removes only approval, not completion',()=>{
 const p=defaultMaintenanceGovernance(),d={executionMode:'confirmed_request',maintenanceGovernance:{version:1,activatedAt:'2026-11-15T00:00:00Z',policy:p}};
 assert.equal(maintenanceAssessmentApprovalRequired({executionMode:'confirmed_request'}),true);
 assert.equal(maintenanceActivationBlockers(p).length,0);
 assert.equal(maintenanceAssessmentApprovalRequired(d),false);
 assert.equal(maintenanceAssessmentReady(d),false);
 const complete={...d,technicalEvaluation:'Adequate technical evaluation',natureCode:'F',criticalityCode:'C',severitySetBy:'u',solutions:[{}],maintenanceTypeCode:'PM',assessmentTasks:[{spares:[],services:[]}],assessmentTasksVersion:1,assessmentTasksAt:'2026-11-15'};
 assert.equal(maintenanceAssessmentReady(complete),true);
 const later=defaultMaintenanceGovernance();later.workOrder.enabled=true;
 assert.equal(maintenanceAssessmentApprovalRequired({...complete,maintenanceGovernance:{version:2,activatedAt:'2026-11-16',policy:later}}),true);
 assert.equal(maintenanceAssessmentReady({...complete,maintenanceGovernance:{version:2,activatedAt:'2026-11-16',policy:later}}),false);
 assert.equal(maintenanceAssessmentReady(complete),true);
});
test('unsupported approval paths cannot be activated',()=>{
 const p=defaultMaintenanceGovernance();p.workRequest.enabled=true;p.technicalClosure.enabled=true;p.workOrder.enabled=true;p.workOrderStage='before_assessment';
 assert.equal(maintenanceActivationBlockers(p).length,2);
});

import {configuredOrderApprovalStage} from './maintenanceGovernancePolicy';
test('all four work-order stages are configurable without requiring duplicate assessment approval',()=>{
 const p=defaultMaintenanceGovernance();p.workOrder.enabled=true;
 for(const stage of ['before_assessment','after_assessment','after_readiness','before_execution'] as const){
  p.workOrderStage=stage;
  const record={executionMode:'confirmed_request',maintenanceGovernance:{version:1,activatedAt:'2026-11-15',policy:p}};
  assert.equal(maintenanceActivationBlockers(p).length,0);
  assert.equal(maintenanceAssessmentApprovalRequired(record),stage==='after_assessment');
  assert.equal(configuredOrderApprovalStage(record),stage==='after_assessment'?null:stage);
 }
});
