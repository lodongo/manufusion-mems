import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../../src/org/WarehouseSetup.tsx',import.meta.url),'utf8');
const start=source.indexOf('function PhysicalStorage(');
const end=source.indexOf('// Topology:',start);
const physical=source.slice(start,end);

test('physical location dialogs adopt site theme tokens and compact mobile layout',()=>{
    for(const token of ['bg-page','bg-panel','border-line','text-ink','text-soft','text-muted','bg-brand','text-onbrand'])
        assert.ok(physical.includes(token),'missing theme token '+token);
    assert.match(physical,/max-h-\[94dvh\]/);
    assert.match(physical,/flex-col overflow-hidden/);
    assert.match(physical,/overflow-y-auto overscroll-contain/);
    assert.match(physical,/break-all/);
    assert.doesNotMatch(physical,/bg-slate-|text-slate-|border-slate-/,'no hard-coded dark site palette');
});

test('physical location linking uses searchable confirmed MEMS dropdown, no implicit material choice',()=>{
    assert.match(physical,/<SelectField id='physical-location-material'/);
    assert.match(physical,/value=\{choice\} required/);
    assert.match(physical,/disabled=\{busy\|\|candidates.length===0\}/);
    assert.doesNotMatch(physical,/<select\b/);
    assert.match(physical,/setChoice\(''\)/,'material selection is cleared on opening a new location');
    assert.match(physical,/if\(!unlink&&!choice\)return/,'no empty material link');
    assert.match(physical,/onClick=\{\(\)=>void changeLink\(false\)\}/,'confirmation button invokes linking');
});

test('physical location preserves audited link and delink actions, controlled access and history',()=>{
    assert.match(physical,/\/api\/org\/inventory\/material\/bin\/link/);
    assert.match(physical,/\/api\/org\/inventory\/material\/bin\/unlink/);
    assert.match(physical,/data.canLink/);
    assert.match(physical,/data.canUnlink/);
    assert.match(physical,/data.canHistory/);
    assert.match(physical,/appConfirm\('Delink this material/);
    assert.match(physical,/\{actionError&&<Alert tone='error'>/);
    assert.match(physical,/role='dialog' aria-modal='true'/);
});
