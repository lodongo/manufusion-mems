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
 assert.match(src,/finding\.title\.length<3\|\|finding\.description\.length<10\|\|!finding\.sourceCode/);
 assert.match(src,/const header=WR_RE\.test\(str\(record\.code\)\)\?assessmentHeaderIssue\(record\)/);
 assert.match(src,/if\(header\)return header/);
});
test('Separate Work Assessment stage and three required finding fields are visible in the UI',()=>{
 const ui=readFileSync('src/org/WorkRequests.tsx','utf8');
 assert.match(ui,/\['assessment','Work Assessment'/);
 assert.match(ui,/Short title \*/);
 assert.match(ui,/What did you find\? \*/);
 assert.match(ui,/Source of the finding \*/);
 assert.match(ui,/Complete missing request details and impacts/);
 assert.match(ui,/Impact \(optional at request; required in Work Assessment\)/);
});
