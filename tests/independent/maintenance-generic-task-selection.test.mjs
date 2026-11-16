import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../src/org/'+p,import.meta.url),'utf8');
test('assessment and service catalogue rows select directly, with fetched details and duplicate-click protection',()=>{
 const picker=read('MntGenericTaskPicker.tsx');
 assert.match(picker,/directSelect\?selectTask\(t\):view\(t\)/);
 assert.match(picker,/selecting\.current=true/);
 assert.match(picker,/await onSelect\(task,releaseId\);setDetail\(null\);setOpen\(false\)/);
 assert.match(picker,/!directSelect&&detail&&/);
 for(const path of ['MntTaskAssessment.tsx','mntSourcing.tsx']){
  const s=read(path);
  const rows=[...s.matchAll(/<GenericTaskPicker[^>]*endpoint='\/api\/org\/mnt\/tasks\/generic'/g)];
  assert.ok(rows.length>0);
  assert.ok(rows.every(r=>r[0].includes('directSelect')));
 }
});
