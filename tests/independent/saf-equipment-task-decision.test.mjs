import test from 'node:test';
import assert from 'node:assert/strict';
import {decideTask,questionsFor} from '../../backend/safTaskDecision.ts';
import {ACTIVITY_CLASSES} from '../../backend/safActivityClasses.ts';
const base={routine:'yes',stop:'yes',body:'no',door:'no',moving:'no',otherExposure:'no',inching:'no',minorProtected:'no',loss:'no',infeasible:'no',partial:'no'};
test('task decision protects against false no-risk and economic override',()=>{
 assert.equal(decideTask({}).code,'');
 assert.equal(decideTask(base).code,'AC01');
 assert.equal(decideTask({...base,body:'yes',loss:'yes'}).code,'AC03');
 assert.equal(decideTask({...base,body:'yes',minorProtected:'yes'}).code,'AC02');
 assert.equal(decideTask({...base,otherExposure:'yes',infeasible:'yes',partial:'yes'}).code,'AC06');
 assert.equal(decideTask({...base,otherExposure:'yes',infeasible:'yes',partial:'no'}).code,'AC05');
 assert.equal(decideTask({...base,inching:'yes'}).code,'AC22');
 assert.equal(decideTask({...base,door:'yes'}).code,'AC03');
 assert.ok(ACTIVITY_CLASSES.some(c=>c.code==='AC22'));
 assert.ok(questionsFor({...base,inching:'yes'}).some(([k])=>k==='partial'));
});
