import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mayDeleteBom} from '../../backend/plnMfgFoundation.ts';

const source=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('BOM deletion is allowed for drafts and rejected revisions, not submitted or live approved masters',()=>{
  assert.equal(mayDeleteBom('draft'),true);
  assert.equal(mayDeleteBom('rejected'),true);
  assert.equal(mayDeleteBom('pending_approval'),false);
  assert.equal(mayDeleteBom('active'),false);
  assert.equal(mayDeleteBom('active',true),true);
  assert.equal(mayDeleteBom('deleted',true),false);
});
test('BOM delete route checks permission, site scope and revision and retains history',()=>{
  const backend=source('backend/plnMfgFoundation.ts');
  const policy=source('backend/permissionPolicy.ts');
  assert.ok(policy.includes("p('MFG.bom.delete'"));
  assert.ok(backend.includes("orgRoute('org.mfg.foundation.delete','MFG.bom.delete'"));
  assert.ok(backend.includes("recordAccess(ctx,'MFG.bom.delete',siteId)"));
  assert.ok(backend.includes("Number(ctx.body.expectedRevision)!==revision"));
  assert.ok(backend.includes("ctx.role==='org_super_admin'&&ctx.testMode===true"));
  assert.ok(backend.includes("status:'deleted'"));
  assert.ok(backend.includes("mfg.bom.delete"));
  assert.ok(backend.includes("linkedToBom(route.data,id)"));
});
test('BOM UI shows secured View/Edit/Delete and inline editable material list without sub-tabs',()=>{
  const ui=source('src/org/ProductionFoundation.tsx');
  assert.ok(ui.includes("const canDeleteBom=canViewMasters&&hasPerm(permissions,'MFG.bom.delete')"));
  assert.ok(ui.includes("active==='boms'&&viewedBom?"));
  assert.ok(ui.includes("onClick={()=>void deleteBom(row)}>Delete"));
  assert.ok(ui.includes("materialsView==='edit'&&"));
  assert.ok(ui.includes("Added materials ({components.length})"));
  assert.ok(!ui.includes("aria-label='BOM materials'"));
  assert.ok(ui.includes("onClick={()=>removeMaterial(index)}>Delete"));
});
