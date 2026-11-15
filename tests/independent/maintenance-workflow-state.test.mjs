import test from 'node:test';import assert from 'node:assert/strict';import {stateOf,transitionPatch,WO_STATES,shortWorkOrderStatus} from '../../backend/maintenanceWorkflowState.ts';
const task={id:'T',persons:2,externalResource:{type:'OEM'}},d={status:'planning',assessmentTasks:[task],assessmentTasksVersion:1,assessmentTasksAt:'2026-01-01',taskPlanning:{}};
test('order-first and priority-driven blocker sequence',()=>{
assert.equal(stateOf({status:'planning'},{}).code,'WO010');
assert.equal(stateOf(d,{}).code,'WO020');
assert.equal(stateOf(d,{approved:true,items:[{spareId:'S',status:'shortage'},{kind:'service',status:'awaiting_sourcing'}]}).code,'WO030');
assert.equal(stateOf(d,{approved:true,items:[{spareId:'S',status:'reserved'},{kind:'service',status:'awaiting_sourcing'}]}).code,'WO040');
assert.equal(stateOf(d,{approved:true,items:[]}).code,'WO050');
const e={...d,taskPlanning:{T:{externalSpecialist:{at:'2026-01-01'}}}};
assert.equal(stateOf(e,{approved:true,items:[]}).code,'WO060');
assert.equal(stateOf({...e,taskPlanning:{T:{...e.taskPlanning.T,allocation:{personnel:['a','b']}}}},{approved:true}).code,'WO070');
});
test('timestamps append only on actual code change; terminal state and retrospective gates',()=>{
const first=transitionPatch({},stateOf({status:'planning'},{}),'2026-01-01','u','User','confirm');
const repeated=transitionPatch(first,stateOf({status:'planning'},{}),'2026-01-02','u','User','refresh');
assert.equal(repeated.workflowSince,'2026-01-01');assert.equal(repeated.workflowTransitions.length,1);
const closed=transitionPatch(repeated,stateOf({status:'closed'},{}),'2026-01-03','u','User','close');
assert.equal(closed.workflowTransitions.length,2);assert.equal(closed.workflowTransitions[1].from,'WO010');
assert.equal(stateOf({status:'in_progress',executionMode:'request_closure',wrCode:'WR00000001',directCompletion:{requestCode:'WR00000001',noSparesOrServices:true},assessmentTasks:[{id:'T'}]},{}).code,'WO200');
assert.equal(new Set(WO_STATES.map(x=>x[0])).size,WO_STATES.length);
});

test('mnemonic state codes are unique and closure blockers precede final sign-off',()=>{assert.equal(shortWorkOrderStatus('WO010'),'DWA');assert.equal(new Set(WO_STATES.map(x=>shortWorkOrderStatus(x[0]))).size,WO_STATES.length);const task={id:'T'},record={status:'completed',assessmentTasks:[task],taskExecution:{T:{status:'completed',reconciled:true}}};assert.equal(stateOf(record,{closureResource:{code:'WO186',reason:'Spare not posted'}}).code,'WO186');assert.equal(stateOf(record,{closureResource:{code:'WO187',reason:'Service acceptance pending'}}).code,'WO187');assert.equal(stateOf({...record,status:'in_progress',taskExecution:{T:{status:'awaiting_feedback'}}},{}).code,'WO170');});

test('retired closure statuses cannot be emitted; early closure ignores unstarted scope and needs safety',()=>{assert.ok(!WO_STATES.some(([code])=>['WO210','WO220'].includes(code)));assert.equal(shortWorkOrderStatus('WO210'),'DOH');const d={status:'in_progress',earlyClosureRequest:{at:'2026-01-01'},assessmentTasks:[{id:'A'},{id:'B'}],taskExecution:{A:{status:'completed',reconciled:true},B:{}}};assert.equal(stateOf(d,{}).code,'WO200');assert.equal(stateOf(d,{openIncident:true}).code,'WO190');assert.equal(stateOf({...d,taskExecution:{A:{status:'awaiting_feedback'}}},{}).code,'WO170');});
