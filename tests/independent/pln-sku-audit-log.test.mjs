import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {skuRevisionFieldChanges} from '../../backend/plnSkuAudit.ts';

const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('SKU audit captures concrete field-level before-and-after values, including nested changes',()=>{
    const changes=skuRevisionFieldChanges(
        {name:'Water',skuComponents:{containerCapacityQuantity:300}},
        {name:'Treated water',skuComponents:{containerCapacityQuantity:350}},
    );
    assert.deepEqual(changes,[
        {field:'name',before:'Water',after:'Treated water'},
        {field:'skuComponents.containerCapacityQuantity',before:'300',after:'350'},
    ]);
});
test('SKU audit omits noisy revision and provenance fields but retains relevant master changes',()=>{
    const changes=skuRevisionFieldChanges(
        {revision:1,updatedAt:'2026-01-01',updatedBy:'old',uom:'L'},
        {revision:2,updatedAt:'2026-01-02',updatedBy:'new',uom:'M3'},
    );
    assert.deepEqual(changes,[{field:'uom',before:'L',after:'M3'}]);
});
test('SKU editor has a dedicated audit log; only other masters retain revision chips',()=>{
    const ui=read('src/org/ProductionFoundation.tsx');
    const be=read('backend/plnMfgFoundation.ts');
    const audit=read('backend/plnSkuAudit.ts');
    assert.ok(ui.includes("active!=='items'&&draft.revision"));
    assert.ok(ui.includes("skuEditTab==='audit'"));
    assert.ok(ui.includes("skuViewTab==='audit'"));
    assert.ok(ui.includes("<PlnSkuAuditLog skuId={draft.id}/>"));
    assert.ok(ui.includes("<PlnSkuAuditLog skuId={viewedSku.id}/>"));
    assert.ok(be.includes("orgRoute('org.mfg.foundation.sku_audit_log','MFG.view'"));
    assert.ok(be.includes("recordAccess(ctx,'MFG.view','')"));
    assert.ok(audit.includes("path+'/revisions'"));
    assert.ok(audit.includes("'organizations/'+ctx.orgId"));
    assert.ok(audit.includes("fieldPath:'targetLabel'"));
});
