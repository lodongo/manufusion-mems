import test from 'node:test';import assert from 'node:assert/strict';
import {validateAssessmentTasks,summarizeAssessmentTasks} from '../../backend/maintenanceTaskAssessment.ts';
const risk=[{hazard:'Stored energy',impact:'Injury',before:'High',after:'Low',controls:'Isolate supply, lock and test for zero energy',permit:'LOTO'}];
const valid=()=>({id:'task1',description:'Replace failed bearing',persons:2,hours:3,rate:0,tools:'Torque wrench',risk,spares:[{source:'description',description:'Bearing specification pending',qty:2,uom:'EA'}],services:[]});
test('spares and services belong to individual tasks',()=>{const tasks=validateAssessmentTasks([valid(),{...valid(),id:'task2',description:'Alignment check',spares:[],services:[]}]);assert.equal(tasks[0].spares.length,1);assert.equal(tasks[1].spares.length,0);assert.deepEqual(summarizeAssessmentTasks(tasks),{taskCount:2,spareCount:1,serviceCount:0,riskCount:2});});
test('risk required for every task',()=>assert.throws(()=>validateAssessmentTasks([{...valid(),risk:[]}]),/risk assessment/));
test('catalogue spare requires code',()=>assert.throws(()=>validateAssessmentTasks([{...valid(),spares:[{source:'catalog',description:'Bearing',qty:1}]}]),/select a source/));
test('at most three proposed suppliers',()=>assert.throws(()=>validateAssessmentTasks([{...valid(),services:[{description:'Vibration analysis',categoryCode:'SERV',subcategoryCode:'PRED',classCode:'VIB',proposedVendorIds:['A','B','C','D']}]}]),/up to 3/));
test('only warehouse sourced spares may carry cost',()=>{const tasks=validateAssessmentTasks([valid()]);assert.equal(tasks[0].spares[0].unitCost,null);});
