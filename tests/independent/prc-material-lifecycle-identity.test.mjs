import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {materialIdentity,validMaterialRequestId} from '../../backend/materialLifecycleIds.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('database-issued material identity families use independent nine-digit sequences',()=>{
    assert.equal(materialIdentity('NWREQ',1),'NWREQ_000000001');
    assert.equal(materialIdentity('EXREQ',7),'EXREQ_000000007');
    assert.equal(materialIdentity('MSTD',123456789),'MSTD_123456789');
    assert.equal(materialIdentity('MSTD',999999999),'MSTD_999999999');
    assert.throws(()=>materialIdentity('MSTD',1000000000),/exhausted/i);
    assert.throws(()=>materialIdentity('NWREQ',0),/exhausted/i);
    assert.throws(()=>materialIdentity('EXREQ',1.25),/exhausted/i);
    assert.equal(validMaterialRequestId('NWREQ_000000001'),true);
    assert.equal(validMaterialRequestId('NWREQ_12345'),false);
    assert.equal(validMaterialRequestId('EXREQ_000000001'),false);
    assert.equal(validMaterialRequestId('MAT-OLD-REQUEST'),true);
});
test('request IDs are reserved atomically and approved master numbering is approval-atomic',()=>{
    const ids=read('backend/materialLifecycleIds.ts');
    assert.ok(ids.includes("NWREQ:'materialNewRequestSequence'"));
    assert.ok(ids.includes("EXREQ:'materialExtensionRequestSequence'"));
    assert.ok(ids.includes("MSTD:'materialMasterDataSequence'"));
    assert.ok(ids.includes('nextSequence(sequenceFields[kind])'));
    assert.ok(ids.includes("nextSequence(sequenceFields.MSTD)"));
    assert.ok(ids.includes('commitChecked(['));
    assert.ok(ids.includes('material_identity_reservations'));
    assert.ok(ids.includes('precondition:{exists:false}'));
    assert.ok(ids.includes('precondition:{updateTime}'));
    assert.ok(ids.includes("str(current.data.status)!=='pending_approval'"));
    // The stores material number is issued in the same commit as approval and the MSTD number, never equal to it.
    assert.ok(ids.includes('{path,data:{...changed,requestId,masterDataId,materialNumber,'));
    assert.ok(ids.includes("material_number_reservations/'+materialNumber"));
    assert.equal(ids.includes('materialNumber:masterDataId'),false);
});
test('creation and extension IDs are issued at request creation and MSTD at final approval',()=>{
    const backend=read('backend/procurement.ts');
    const list=read('src/org/MaterialsMaster.tsx');
    const dashboard=read('src/org/MaterialMasterDashboard.tsx');
    assert.ok(backend.includes("kind:'NWREQ',collection:'materials'"));
    assert.ok(backend.includes("kind:'EXREQ',collection:'material_extensions'"));
    assert.ok(backend.includes('approveWithMasterIdentity({'));
    assert.ok(backend.includes("if(!extension&&next==='approved')"));
    assert.ok(backend.includes("warehouseIds:[...new Set(["));
    assert.equal(backend.includes("if(action==='allocate')"),false);
    assert.equal(backend.includes("if(action==='push')"),false);
    assert.ok(list.includes('storesNumberText(m)'),'lists show the stores number, never a request number in its place');
    assert.ok(dashboard.includes('Creation request ID'));
    assert.ok(dashboard.includes('Approved master data ID'));
    assert.ok(dashboard.includes("{ key: 'approvals', label: 'Approvals' }"));
    assert.ok(dashboard.includes('testOverride={m.testOverride}'));
});
test('test-mode superadmin approvals override maker-checker only in authorized development mode and are audited',()=>{
    const backend=read('backend/procurement.ts');
    const core=read('backend/testModeCore.ts');
    const inbox=read('src/org/WorkflowInbox.tsx');
    assert.ok(backend.includes("if(ctx.testMode===true&&ctx.role==='org_super_admin')"));
    assert.ok(backend.includes("bypass(ctx,'material.workflow.assignment_and_maker_checker')"));
    assert.ok(backend.includes("testOverride:ctx.testMode===true&&ctx.role==='org_super_admin'"));
    assert.ok(inbox.includes('x.testOverride === true || !x.isMine'));
    assert.ok(inbox.includes('testOverride={x.testOverride===true}'));
    assert.ok(core.includes("process.env.MEMS_ENVIRONMENT !== 'development'"));
    assert.ok(core.includes("if (ctx.testMode !== true) return false;"));
});
