import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=(name)=>readFileSync(new URL('../../src/org/'+name,import.meta.url),'utf8');
test('work request has a compact left viewer with request, tasks, and summary',()=>{
 const ui=src('WorkRequests.tsx');
 assert.match(ui,/aria-label='Assessment sections'/);
 assert.match(ui,/grid-cols-\[64px_minmax\(0,1fr\)\]/);
 assert.match(ui,/\['request','Request'/);
 assert.match(ui,/\['tasks','Tasks'/);
 assert.match(ui,/\['summary','Summary'/);
 assert.match(ui,/overflow-x-hidden/);
 assert.doesNotMatch(ui,/flex gap-2 overflow-x-auto pb-1'>\s*\{buttons.map/);
});
test('tasks start as a list, with add action and individual 4-part editor',()=>{
 const ui=src('MntTaskAssessment.tsx');
 assert.match(ui,/useState<TaskAssessment\[]>\(initial\)/);
 assert.match(ui,/useState<number\|null>\(null\)/);
 assert.match(ui,/\+ Add Task/);
 assert.match(ui,/\['Task','Spares','People & tools','Safety'\]/);
 assert.match(ui,/Done — back to tasks/);
 assert.match(ui,/Save assessment for review/);
});
test('reviewer is read-only and task changes are not lost silently on navigation',()=>{
 const tasks=src('MntTaskAssessment.tsx');
 const ui=src('WorkRequests.tsx');
 assert.match(tasks,/if\(!editable\)return <div/);
 assert.match(tasks,/<ReviewAssessment tasks=\{\[task\]\}/);
 assert.match(ui,/tasksDirty&&!\(await appConfirm/);
 assert.match(ui,/function AssessmentSummary/);
 assert.match(ui,/canReview/);
 assert.match(ui,/editable=\{can.assess&&!can.reviewAssessment\}/);
 assert.match(ui,/if \(can.assess && !can.reviewAssessment\)/);
});
