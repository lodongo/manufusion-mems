import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = p => readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const backend=read('backend/procurement.ts');
const material=read('src/org/MaterialsMaster.tsx');
const workflow=read('src/org/MaterialWorkflow.tsx');
const inbox=read('src/org/WorkflowInbox.tsx');

test('new creation and warehouse extension require PRC-001 and PRC-002, not a fixed 3-person chain',()=>{
    assert.ok(backend.includes("configuredMaterialWorkflow(ctx.orgId,'PRC-001')"));
    assert.ok(backend.includes("configuredMaterialWorkflow(ctx.orgId,'PRC-002')"));
    assert.ok(backend.includes("'POST /api/org/procurement/materials/extension'"));
    assert.ok(backend.includes("workflowSnapshot:workflow"));
    assert.ok(!backend.includes("'POST /api/org/procurement/materials/workflow':"));
    assert.ok(!backend.includes("'POST /api/org/procurement/materials/workflow/migrate':"));
});
test('review and approve roles, actions and SoD are enforced from workflow snapshot',()=>{
    assert.ok(backend.includes("function materialWorkflowSnapshot("));
    assert.ok(backend.includes("function materialApproverCanAct("));
    assert.ok(backend.includes("approvedEarlierLevel(record.approvalHistory,ctx.uid)"));
    assert.ok(backend.includes("if(step.mode==='user'&&step.uid===ctx.uid)"));
    assert.ok(backend.includes("if(step.mode==='role'&&roleSet.has(step.role))"));
    assert.ok(backend.includes("if(step.mode==='manager')"));
    assert.ok(backend.includes("step.action==='approve'"));
    assert.ok(backend.includes("makeMaterialDecision(ctx,'creation')"));
    assert.ok(backend.includes("makeMaterialDecision(ctx,'extension')"));
    assert.ok(workflow.includes("Review material and recommend"));
    assert.ok(workflow.includes("Approve material or extension"));
    assert.ok(workflow.includes("action:s.action"));
});
test('material extension starts from approved organization master, not PRC reference catalogue',()=>{
    assert.ok(backend.includes("getDoc(root+'/materials/'+sourceId)"));
    assert.ok(backend.includes("Only approved or active organization materials can be extended"));
    assert.ok(backend.includes("source.data.warehouseIds"));
    assert.ok(backend.includes("getDoc(root+'/warehouses/'+warehouseId)"));
    assert.ok(backend.includes("warehouseIds:[...new Set("));
    assert.ok(material.includes('Extend from Organization Materials Master'));
    assert.ok(material.includes('approvedMasterMaterials='));
    assert.ok(material.includes('extensionSearchResults='));
    assert.ok(material.includes('extensionTargets='));
    assert.ok(material.includes('Submit extension through PRC-002 workflow'));
});
test('retired approval migration is absent and unbound requests fail closed',()=>{
    assert.equal(backend.includes("'POST /api/org/procurement/materials/workflow/migrate'"),false);
    assert.equal(workflow.includes('Find and migrate legacy pending requests'),false);
    assert.ok(backend.includes('This request has no valid workflow snapshot.'));
    assert.ok(backend.includes('Workflow snapshot missing · administrator review required'));
    assert.ok(backend.includes("materialWorkflowSnapshot(data)"));
    assert.ok(backend.includes("if(!workflow||workflow.code!==(extension?'PRC-002':'PRC-001'))"));
});
test('user-facing material approval and inbox show configured stage names instead of fixed approver numbers',()=>{
    assert.ok(material.includes("workflowStage?:string"));
    assert.ok(material.includes("label:'Workflow stage'"));
    assert.ok(material.includes("m.workflowStage||'Workflow assignment required'"));
    assert.ok(inbox.includes("workflowStage?: string"));
    assert.ok(inbox.includes("label: 'Workflow stage'"));
});
