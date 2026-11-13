import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=(name)=>readFileSync(new URL('../../src/org/'+name,import.meta.url),'utf8');
test('work request separates Request, Work Assessment, Assessment Tasks and Summary in the top menu',()=>{
 const ui=src('WorkRequests.tsx');
 assert.match(ui,/aria-label='Work request menu'/);
 assert.doesNotMatch(ui,/grid-cols-\[64px_minmax\(0,1fr\)\]/);
 assert.doesNotMatch(ui,/Related or duplicate request/);
 assert.doesNotMatch(src('MntWorkOrder.tsx'),/lg:grid-cols-\[260px/);
 assert.match(ui,/\['request','Work Request'/);
 assert.match(ui,/\['assessment','Work Assessment'/);
 assert.match(ui,/\['tasks','Assessment Tasks'/);
 assert.match(ui,/\['summary','Summary'/);
 assert.match(ui,/overflow-x-hidden/);
 assert.doesNotMatch(ui,/flex gap-2 overflow-x-auto pb-1'>\s*\{buttons.map/);
});
test('failure mode and assembly selection belong to assessment, not request enrichment',()=>{
 const ui=src('WorkRequests.tsx');
 assert.doesNotMatch(ui,/function EnrichRequest/);
 assert.doesNotMatch(ui,/Add assembly & details|Complete missing request details and impacts/);
 assert.match(ui,/label='Assembly to assess \*'/);
 assert.match(ui,/title='2\. Failure mode \*'/);
 assert.match(ui,/assemblyId, natureCode: nature/);
});
test('tasks start as a list, with add action and individual 5-part editor (services per addendum)',()=>{
 const ui=src('MntTaskAssessment.tsx');
 assert.match(ui,/useState<TaskAssessment\[]>\(initial\)/);
 assert.match(ui,/useState<number\|null>\(null\)/);
 assert.match(ui,/\+ Add Task/);
 assert.match(ui,/\['Task','Spares','Services','People & tools','Safety'\]/);
 assert.match(ui,/<AddSpare /,'Spares are added from the selected warehouse, the catalogue or free text');
 assert.match(ui,/Warehouse \(select first\)/);
 assert.match(ui,/Save task<\/Button>/);
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
