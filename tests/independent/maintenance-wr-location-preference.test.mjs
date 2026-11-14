import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const wr=readFileSync('src/org/WorkRequests.tsx','utf8');
const picker=readFileSync('src/org/mntShared.tsx','utf8');
const backend=readFileSync('backend/maintenance.ts','utf8');
test('new work requests browse the remembered site instead of selecting the last equipment',()=>{
 assert.ok(backend.includes('lastSiteId: place.site?.id'));
 assert.ok(backend.includes('lastSiteId, lastSelectionId'));
 assert.ok(picker.includes('available(data.lastSiteId)'));
 assert.ok(picker.includes('rememberSiteId: id'));
 assert.ok(!wr.includes('void choose(lastSelectionId)'));
 assert.ok(wr.includes('if (assemblyId) void choose(assemblyId)'));
});
test('back moves one location level and then one wizard step',()=>{
 assert.ok(picker.includes('moveTo(parent)'));
 assert.ok(picker.includes("if (q.trim()) { setQ(''); return true; }"));
 assert.ok(wr.includes('pickerBack.current?.()'));
 assert.ok(wr.includes('if (step > 0) setStep(step - 1)'));
 assert.ok(wr.includes('initialBrowseId={browseId.current}'));
});
