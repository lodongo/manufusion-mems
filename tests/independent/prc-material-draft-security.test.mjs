import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    materialApprovalNotStarted,
    materialMakerIds,
    materialDraftCan,
    materialMakerCheckerConflict,
} from '../../backend/materialDraftSecurity.ts';

const read = path => readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const draft = {status:'draft',approvalLevel:0,createdBy:'alice',makerUids:['alice']};
const creator = ['PRC.create'];
const delegateEdit = ['PRC.materials.draft.edit.any'];
const delegateDelete = ['PRC.materials.draft.delete.any'];
const delegateSubmit = ['PRC.materials.draft.submit.any'];

test('edit, delete and submit are allowed only before the first approval begins',()=>{
    assert.equal(materialApprovalNotStarted(draft),true);
    assert.equal(materialDraftCan(draft,'alice',creator,'edit'),true);
    assert.equal(materialDraftCan(draft,'alice',creator,'delete'),true);
    assert.equal(materialDraftCan(draft,'alice',creator,'submit'),true);
    for(const changed of [
        {...draft,status:'pending_approval'},
        {...draft,status:'rejected',approvalLevel:2},
        {...draft,submittedAt:'2026-11-21T11:00:00Z'},
        {...draft,workflowCode:'PRC-001'},
        {...draft,workflowSnapshot:{code:'PRC-001'}},
        {...draft,approvalLevel:1},
        {...draft,approvalHistory:[{decision:'reject',by:'bob'}]},
    ]){
        assert.equal(materialApprovalNotStarted(changed),false);
        for(const action of ['edit','delete','submit']){
            assert.equal(materialDraftCan(changed,'alice',creator,action),false);
            assert.equal(materialDraftCan(changed,'super',[],action,true),false);
        }
    }
});
test('designated delegates need each action explicitly and cannot inherit creator privileges',()=>{
    assert.equal(materialDraftCan(draft,'bob',delegateEdit,'edit'),true);
    assert.equal(materialDraftCan(draft,'bob',delegateEdit,'delete'),false);
    assert.equal(materialDraftCan(draft,'bob',delegateDelete,'delete'),true);
    assert.equal(materialDraftCan(draft,'bob',delegateSubmit,'submit'),true);
    assert.equal(materialDraftCan(draft,'bob',['PRC.*'],'edit'),true);
    assert.equal(materialDraftCan(draft,'bob',['PRC.materials.draft.edit.*'],'edit'),true);
    assert.equal(materialDraftCan(draft,'bob',['PRC.materials.draft.edit.*'],'delete'),false);
    assert.equal(materialDraftCan(draft,'bob',['*'],'submit'),true);
    assert.equal(materialDraftCan(draft,'bob',['PRC.view'],'edit'),false);
    assert.equal(materialDraftCan(draft,'bob',['PRC.edit'],'delete'),false);
    assert.equal(materialDraftCan(draft,'bob',[], 'edit',true),true);
    assert.equal(materialDraftCan(draft,'alice',['PRC.materials.draft.delete.own'],'delete'),true);
    assert.equal(materialDraftCan(draft,'bob',['PRC.materials.draft.delete.own'],'delete'),false);
});
test('original creator, delegated editors and submitters are all makers even after hand-off',()=>{
    const recorded={...draft,updatedBy:'bob',makerUids:['alice','bob'],submittedBy:'charlie'};
    assert.deepEqual(materialMakerIds(recorded),['alice','bob','charlie']);
    for(const uid of ['alice','bob','charlie'])assert.equal(materialMakerCheckerConflict(recorded,uid),true);
    assert.equal(materialMakerCheckerConflict(recorded,'dave'),false);
    assert.equal(materialMakerCheckerConflict({...recorded,approvalHistory:[{by:'dave',decision:'approve'}]},'dave'),true);
});
test('runtime routes gate all write actions, use optimistic locking, audit and test overrides',()=>{
    const backend=read('backend/procurement.ts');
    const policy=read('backend/permissionPolicy.ts');
    const master=read('src/org/MaterialsMaster.tsx');
    const ui=read('src/org/MaterialMasterDashboard.tsx');
    const overrides=read('backend/testModeCore.ts');
    for(const action of ['edit','delete','submit']){
        assert.ok(backend.includes("materialDraftCan("));
        assert.ok(policy.includes("PRC.materials.draft."+action+".own"));
        assert.ok(policy.includes("PRC.materials.draft."+action+".any"));
    }
    assert.ok(backend.includes('materialMakerCheckerConflict(record,ctx.uid)'));
    assert.ok(backend.includes("bypass(ctx,'material.workflow.assignment_and_maker_checker')"));
    assert.ok(backend.includes('makerUids:materialMakerIds('));
    assert.ok(backend.includes('{updateTime:doc.updateTime}'));
    assert.ok(backend.includes("'procurement.material.draft_delete'"));
    assert.ok(backend.includes("'procurement.material.draft_autosave'"));
    assert.ok(backend.includes("status:'deleted'"));
    assert.ok(backend.includes("filter(d=>str(d.data.status)!=='deleted')"));
    // Row actions were moved into the selected material dashboard.
    assert.ok(master.includes('onRowClick={setReviewMaterial}'));
    assert.ok(!master.includes("key:'actions',label:'Actions'"));
    assert.match(ui,/m\.canEdit && <Button/);
    assert.match(ui,/m\.canDelete && <Button/);
    assert.match(ui,/m\.canSubmit \? \(/);
    assert.ok(overrides.includes('testModeEnvironmentAllowed'));
});
