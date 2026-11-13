import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessmentHeaderIssue} from '../../backend/maintenance.ts';

test('Assessment requires missing Work Request title, description, source and impact',()=>{
 const record={
  title:'Bearing failure',titleAuto:false,description:'Output bearing is running hot',sourceCode:'OPR',
  impacts:[{code:'DOWNTIME'}],technicalEvaluation:'Inspection confirmed excessive bearing vibration.',
  natureCode:'FM-01',criticalityCode:'R-03',severitySetBy:'assessor',
  solutions:[{code:'SOL-01'}],maintenanceTypeCode:'MAI-006'
 };
 assert.equal(assessmentHeaderIssue(record),'');
 for(const [field,expected] of [
  ['title','short title'],['description','finding description'],['sourceCode','source of finding'],
  ['impacts','impact (at least one)']
 ]){
  const altered={...record,[field]:field==='impacts'?[]:''};
  assert.match(assessmentHeaderIssue(altered),new RegExp(expected.replace(/[()]/g,'\\$&')));
 }
 assert.match(assessmentHeaderIssue({...record,titleAuto:true}),/short title/);
});
test('Legacy assessments are not allowed to bypass newly required finding completeness',()=>{
 const legacy={maintenanceTypeCode:'MAI-001',workTypeCode:'W-01',priorityCode:'P-01',disciplineCode:'M-01'};
 assert.match(assessmentHeaderIssue(legacy),/short title/);
 assert.match(assessmentHeaderIssue(legacy),/impact/);
});
test('Work Request mandatory fields are enforced on server and assessment review cannot bypass them',()=>{
 const src=readFileSync('backend/maintenance.ts','utf8');
 assert.match(src,/finding\.title\.length\s*<\s*3\s*\|\|\s*finding\.description\.length\s*<\s*10\s*\|\|\s*!finding\.sourceCode\s*\|\|\s*!finding\.impacts\.length/);
 assert.match(src,/const header=WR_RE\.test\(str\(record\.code\)\)\?assessmentHeaderIssue\(record\)/);
 assert.match(src,/if\(header\)return header/);
});
test('Work Assessment has a separate submodule and all four finding fields are required',()=>{
 const ui=readFileSync('src/org/WorkRequests.tsx','utf8');
 assert.match(ui,/\['assessment','Work Assessment'/);
 assert.match(ui,/Short title \*/);
 assert.match(ui,/What did you find\? \*/);
 assert.match(ui,/Source of the finding \*/);
 assert.doesNotMatch(ui,/Complete missing request details and impacts|function EnrichRequest|Add assembly & details/);
 assert.match(ui,/label='Assembly to assess \\*'/);
 assert.match(ui,/title='2\\. Failure mode \\*'/);
 assert.match(ui,/natureCode: nature/);
 assert.match(ui,/title='Impact' required multi|title='Impact'[\s\S]*?required/);
 const home=readFileSync('src/org/OrgHomePage.tsx','utf8');
 assert.match(home,/label: 'Work assessments', path: 'work_assessments'/);
 assert.match(ui,/area === 'assessments'/);
});
