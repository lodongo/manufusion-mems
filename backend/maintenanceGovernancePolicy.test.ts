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
