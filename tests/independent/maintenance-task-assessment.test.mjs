import test from 'node:test';import assert from 'node:assert/strict';
import {validateAssessmentTasks,summarizeAssessmentTasks} from '../../backend/maintenanceTaskAssessment.ts';
const risk=[{hazard:'Stored energy',impact:'Injury',before:'High',after:'Low',controls:'Isolate supply, lock and test for zero energy',permit:'LOTO'}];
const valid=()=>({id:'task1',description:'Replace failed bearing',persons:2,hours:3,rate:0,tools:'Torque wrench',risk,spares:[{source:'description',description:'Bearing specification pending',qty:2,uom:'EA'}],services:[]});
test('spares and services belong to individual tasks',()=>{const tasks=validateAssessmentTasks([valid(),{...valid(),id:'task2',description:'Alignment check',spares:[],services:[]}]);assert.equal(tasks[0].spares.length,1);assert.equal(tasks[1].spares.length,0);assert.deepEqual(summarizeAssessmentTasks(tasks),{taskCount:2,spareCount:1,serviceCount:0,riskCount:2});});
test('risk required for every task',()=>assert.throws(()=>validateAssessmentTasks([{...valid(),risk:[]}]),/risk assessment/));
test('catalogue spare requires code',()=>assert.throws(()=>validateAssessmentTasks([{...valid(),spares:[{source:'catalog',description:'Bearing',qty:1}]}]),/select a source/));
test('at most three proposed suppliers',()=>assert.throws(()=>validateAssessmentTasks([{...valid(),services:[{description:'Vibration analysis',categoryCode:'SERV',subcategoryCode:'PRED',classCode:'VIB',proposedVendorIds:['A','B','C','D']}]}]),/up to 3/));
test('only warehouse sourced spares may carry cost',()=>{const tasks=validateAssessmentTasks([valid()]);assert.equal(tasks[0].spares[0].unitCost,null);});

test('new tasks require internal role selection or an external provider',()=>{
 assert.throws(()=>validateAssessmentTasks([{...valid(),internalRoles:[],externalResource:undefined}]),/internal role or an external resource/);
 const tasks=validateAssessmentTasks([{...valid(),internalRoles:[],externalResource:{type:'OEM',persons:2,notes:'OEM mechanical specialist'}}]);
 assert.equal(tasks[0].persons,0);
 assert.equal(tasks[0].externalResource.type,'OEM');
 assert.equal(tasks[0].externalResource.persons,2);
});
test('only recognized internal and external roles are accepted',()=>{
 assert.throws(()=>validateAssessmentTasks([{...valid(),internalRoles:['security_guard']}]),/valid internal resource/);
 assert.throws(()=>validateAssessmentTasks([{...valid(),externalResource:{type:'unknown',persons:1}}]),/valid external resource/);
 const tasks=validateAssessmentTasks([{...valid(),internalRoles:['operator','technician','specialist','engineer']}]);
 assert.equal(tasks[0].internalRoles.length,4);
});
test('spare can be specified using photo alone or description alone',()=>{
 const photo='organizations/demo/mnt/assessment_photos/author/123456789abc.jpg';
 const [t]=validateAssessmentTasks([{...valid(),spares:[{source:'description',description:'',photoPath:photo,qty:1,uom:'EA'}]}]);
 assert.equal(t.spares[0].photoPath,photo);
 assert.match(t.spares[0].description,/photo/);
 assert.throws(()=>validateAssessmentTasks([{...valid(),spares:[{source:'description',description:'',qty:1}]}]),/source and item/);
});
test('LOTO requires explicit source selection and retains live-equipment and SAF permit flags',()=>{
 assert.throws(()=>validateAssessmentTasks([{...valid(),lotoRequired:true,energySourceCodes:[]}]),/hazardous energy source/);
 const [t]=validateAssessmentTasks([{...valid(),lotoRequired:true,energySourceCodes:['SAF_03_01_001'],liveEquipment:true,permitCodes:['SAF_08_01_003','SAF_08_01_004']}]);
 assert.equal(t.lotoRequired,true);
 assert.equal(t.liveEquipment,true);
 assert.deepEqual(t.energySourceCodes,['SAF_03_01_001']);
 assert.equal(t.permitCodes.length,2);
});
