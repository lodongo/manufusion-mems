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
test('all three independent approval switches and work order stages can be configured',()=>{
 const p=defaultMaintenanceGovernance();p.workRequest.enabled=true;p.technicalClosure.enabled=true;p.workOrder.enabled=true;p.workOrderStage='before_assessment';
 assert.equal(maintenanceActivationBlockers(p).length,0);
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

import {workRequestApprovalRequired} from './maintenanceGovernancePolicy';
test('request policy uses confirmation type, and unknown facts fail conservatively',()=>{
 const p=defaultMaintenanceGovernance();p.workRequest.enabled=true;p.workRequest.conditions=[{field:'maintenanceType',op:'eq',value:'PM'}];
 const d={maintenanceGovernance:{version:1,activatedAt:'2026-11-15',policy:p}};
 assert.equal(workRequestApprovalRequired({},'PM'),false);
 assert.equal(workRequestApprovalRequired(d,'PM'),true);
 assert.equal(workRequestApprovalRequired(d,'CM'),false);
 p.workRequest.conditions=[{field:'requiresSpares',op:'eq',value:true}];
 assert.equal(workRequestApprovalRequired(d,'CM'),true);
});

import {technicalClosureApprovalRequired} from './maintenanceGovernancePolicy';
test('technical closure is optional and independent of work request and WO approval',()=>{
 const p=defaultMaintenanceGovernance();p.technicalClosure.enabled=true;
 const d={maintenanceGovernance:{version:1,activatedAt:'2026-11-15',policy:p}};
 assert.equal(technicalClosureApprovalRequired({}),false);
 assert.equal(technicalClosureApprovalRequired(d),true);
 p.technicalClosure.conditions=[{field:'priority',op:'eq',value:'HIGH'}];
 assert.equal(technicalClosureApprovalRequired({...d,priorityCode:'LOW'}),false);
 assert.equal(technicalClosureApprovalRequired(d),true);
});

import {recordFacts} from './maintenanceGovernancePolicy';
test('numeric condition facts come from validated assessed tasks or current finance estimates',()=>{
 const task={persons:2,hours:3,rate:10,spares:[{qty:2,unitCost:5}],services:[{expectedCost:30}],risk:[{beforeScore:{score:12}}]};
 const d={assessmentTasks:[task],assessmentTasksAt:'2026-11-15',assessmentTasksVersion:1};
 assert.deepEqual(recordFacts(d).estimatedCost,100);
 assert.deepEqual(recordFacts(d).riskScore,12);
 assert.equal(recordFacts({...d,assessmentTasks:[{...task,services:[{expectedCost:null}]}]}).estimatedCost,undefined);
 assert.equal(recordFacts({...d,costApproval:{status:'approved',version:1,amount:125}}).estimatedCost,125);
});

test('version zero is the new-record default; legacy records without snapshots remain unchanged',()=>{
 const d={executionMode:'confirmed_request',maintenanceGovernance:{version:0,activatedAt:'2026-11-15T00:00:00Z',policy:defaultMaintenanceGovernance()}};
 assert.equal(maintenanceAssessmentApprovalRequired(d),false);
 assert.equal(maintenanceAssessmentApprovalRequired({executionMode:'confirmed_request'}),true);
 assert.equal(technicalClosureApprovalRequired(d),false);
});
