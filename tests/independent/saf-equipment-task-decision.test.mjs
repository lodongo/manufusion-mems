import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {decideTask,questionsFor,taskDecisionPath,answerTaskQuestion,backTaskQuestion,taskRiskAssessmentPending} from '../../backend/safTaskDecision.ts';
import {ACTIVITY_CLASSES} from '../../backend/safActivityClasses.ts';
const base={routine:'yes',stop:'yes',body:'no',door:'no',moving:'no',otherExposure:'no',nonEnergy:'no',inching:'no',minorProtected:'no',loss:'no',infeasible:'no',partial:'no'};
test('task decision protects against false no-risk and economic override',()=>{
 assert.equal(decideTask({}).code,'');
 assert.equal(decideTask(base).code,'AC01');
 assert.equal(decideTask({...base,body:'yes',loss:'yes'}).code,'AC03');
 assert.equal(decideTask({...base,body:'yes',minorProtected:'yes'}).code,'AC02');
 assert.equal(decideTask({...base,otherExposure:'yes',infeasible:'yes',partial:'yes'}).code,'AC06');
 assert.equal(decideTask({...base,otherExposure:'yes',infeasible:'yes',partial:'no'}).code,'AC05');
 assert.equal(decideTask({...base,inching:'yes'}).code,'AC22');
 assert.equal(decideTask({...base,door:'yes'}).code,'AC03');
 assert.equal(decideTask({...base,door:'yes',moving:'yes',minorProtected:'yes'}).code,'AC03');
 assert.equal(decideTask({...base,nonEnergy:'yes'}).code,'AC20');
 assert.ok(ACTIVITY_CLASSES.some(c=>c.code==='AC22'));
 assert.ok(!questionsFor({...base,inching:'yes'}).some(([k])=>k==='partial'));
 assert.ok(!questionsFor({...base,body:'yes',minorProtected:'yes'}).some(([k])=>k==='loss'));
});

test('task inherits assessment snapshots and additional risks cannot replace the baseline',()=>{
 const api=readFileSync('backend/safEquipment.ts','utf8');
 assert.ok(api.includes('classBaseline:baseline'));
 assert.ok(api.includes('baseline.some(b=>b.status===\'intolerable\')'));
 assert.ok(api.includes('Retain the class-level permit requirements'));
});

test('wizard exposes a single unanswered question and terminal result ignores stale branch responses',()=>{
 let a={};let state=taskDecisionPath(a);assert.equal(state.next[0],'routine');assert.deepEqual(state.path.map(q=>q[0]),['routine']);
 a=answerTaskQuestion(a,'routine','yes');assert.equal(taskDecisionPath(a).next[0],'stop');
 assert.deepEqual(answerTaskQuestion(a,'inching','yes'),a);
 const terminal={...base,inching:'yes',infeasible:'yes',partial:'yes'};
 state=taskDecisionPath(terminal);assert.equal(state.decision.code,'AC22');assert.equal(state.next,null);assert.equal(state.answers.partial,undefined);
 a=backTaskQuestion(terminal);assert.equal(taskDecisionPath(a).next[0],'inching');assert.equal(a.inching,undefined);
 a=answerTaskQuestion(a,'inching','no');assert.equal(taskDecisionPath(a).next[0],'nonEnergy');
 a=answerTaskQuestion(a,'nonEnergy','no');assert.equal(taskDecisionPath(a).decision.code,'AC01');assert.equal(taskDecisionPath(a).next,null);
});


test('global class assessments are optional; task coverage remains independently reviewable',()=>{
 assert.equal(taskRiskAssessmentPending('AC02',1,false,false),false);
 assert.equal(taskRiskAssessmentPending('AC02',0,true,true),false);
 assert.equal(taskRiskAssessmentPending('AC02',0,true,false),true);
 assert.equal(taskRiskAssessmentPending('AC02',0,false,true),true);
 assert.equal(taskRiskAssessmentPending('AC02',0,false,false),true);
 assert.equal(taskRiskAssessmentPending('AC01',0,false,false),false);
 const api=readFileSync('backend/safEquipment.ts','utf8');
 const ui=readFileSync('src/org/EquipmentTasks.tsx','utf8');
 assert.ok(!api.includes('baselineComplete'));
 assert.ok(!ui.includes('Complete missing class assessments'));
 assert.ok(api.includes('task_assessment_pending'));
 assert.ok(api.includes('executionAuthorized:false'));
 assert.ok(api.includes('inherited.has(h)||seen.has(h)'));
 assert.ok(ui.includes('Save task (assessment pending)'));
});
