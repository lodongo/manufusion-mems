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
 assert.ok(ui.includes("label='Assembly to assess (optional)'"));
 assert.match(ui,/title='2\. Failure mode \*'/);
 assert.match(ui,/assemblyId, natureCode: nature/);
});
test('tasks start as a list, with add action and individual editor with separate Tools and Equipment',()=>{
 const ui=src('MntTaskAssessment.tsx');
 assert.match(ui,/useState<TaskAssessment\[]>\(/);
 assert.match(ui,/useState<number\|null>\(null\)/);
 assert.match(ui,/\+ Add Task/);
 assert.match(ui,/\['Assessment setup','Task','Spares','Services','Resources','Tools','Equipment','Safety'\]/);
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

test('awaiting assessment action is visible without a saved draft and explains denied authority',()=>{const ui=src('MntWorkOrder.tsx');assert.match(ui,/wo\.workflowCode==='WO010'/);assert.match(ui,/Continue assessment/);assert.match(ui,/disabled=\{!can\.assess\} onClick=\{openAssessment\}/);assert.match(ui,/assessmentBlockReason/);assert.match(ui,/!wo\.assessedAt\|\|wo\.assessmentDraft\?\.header/);});

test('service assessment excludes commercial sourcing and Resources is internal-only',()=>{const ui=src('MntTaskAssessment.tsx'),sourcing=src('mntSourcing.tsx');assert.match(ui,/title='Resources'/);assert.match(sourcing,/Specialist personnel required for this service/);assert.doesNotMatch(ui,/title='External specialist resource'/);assert.doesNotMatch(sourcing.slice(sourcing.indexOf('export function ServiceEditor'),sourcing.indexOf('// ----- Work-order task')),/Supplier category and vendors|Execution date|num\('expectedCost'/);});

test('mobile resource role summaries drill into subtask allocations and overhead is planning-only',()=>{const assess=src('MntTaskAssessment.tsx'),plan=src('MntWorkOrder.tsx');assert.match(assess,/Decrease .*headcount/);assert.match(assess,/Increase .*headcount/);assert.match(assess,/<details key=\{r.roleCode\}/);assert.match(assess,/formatHours\(r.persons\*r.hours\)/);assert.doesNotMatch(assess,/Additional overhead resources|including overhead/);assert.match(plan,/Additional overhead resources/);assert.match(plan,/Add overhead role/);});
