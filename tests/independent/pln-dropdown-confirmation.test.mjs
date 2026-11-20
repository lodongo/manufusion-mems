import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('shared MEMS dropdown stages choices and makes mobile confirmation visible',()=>{
 const ui=read('src/components/SearchableSelect.tsx');
 assert.ok(ui.includes('onClick={() => setPending(o.value)}'));
 assert.ok(ui.includes('onChange?.({ target: { value: v, name, id }'));
 assert.ok(ui.includes('onClick={() => { if (pending !== null) choose(pending); }}'));
 assert.ok(ui.includes("aria-label='Confirm selection'"));
 assert.ok(ui.includes("aria-label='Cancel selection'"));
 assert.ok(ui.includes('min-h-0 flex-1 overflow-y-auto'));
 assert.ok(ui.includes('shrink-0 border-t border-line'));
 assert.ok(ui.includes('env(safe-area-inset-bottom)'));
 assert.ok(ui.includes('h-[min(88dvh,760px)]'));
});

test('all Production Planning and MRP selectors use the reusable confirmation template',()=>{
 const paths=[
  'src/org/ProductionFoundation.tsx','src/org/MfgSkuSetup.tsx',
  'src/org/PlnCostCenterSkuSetup.tsx','src/org/PlnCostCenterSetup.tsx',
  'src/org/PlnDemand.tsx','src/org/PlnFormDefaultsPanel.tsx',
  'src/org/PlnProcessRoutingEditor.tsx'
 ];
 for(const path of paths){
  const ui=read(path);
  assert.ok(ui.includes('<SelectField'),path+' must use MEMS SelectField');
  assert.doesNotMatch(ui,/<select\b/,path+' must not use native select');
 }
 const navigation=read(paths[0]);
 assert.ok(navigation.includes("id='manufacturing-step-select' label='Configuration sequence' hideLabel value={active}"));
 assert.ok(navigation.includes('<optgroup'));
 const product=read(paths[1]);
 const rating=read(paths[2]);
 assert.ok(product.includes('primary-container-rating-output-type'));
 assert.ok(rating.includes('rated-output-type-'));
 assert.ok(product.includes('throughputOutputGroups()'));
 assert.ok(rating.includes('throughputOutputGroups()'));
});
