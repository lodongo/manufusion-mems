import test from 'node:test';import assert from 'node:assert/strict';import {summarizeWorkOrderReview} from '../../backend/maintenanceStatusReview.ts';
test('delay time is split by recorded state, without manufacturing historical state detail',()=>{
const d={createdAt:'2026-11-14T00:00:00Z',status:'in_progress',workflowTransitions:[{to:'WO030',label:'Spares',at:'2026-11-14T12:00:00Z'},{to:'WO160',label:'Execution',at:'2026-11-15T06:00:00Z'}],assessmentTasks:[{id:'T',hours:2,persons:3,rate:10}],taskExecution:{T:{status:'completed',feedback:{actualHours:4},reconciled:true,consumption:[{consumed:2,unitCost:15}]}}};
const r=summarizeWorkOrderReview(d,'2026-11-15T12:00:00Z','2026-11-15T00:00:00Z');
assert.equal(r.leadHours,36);assert.equal(r.overdueHours,12);assert.deepEqual(r.states.map(x=>[x.code,x.hours,x.overdueHours]),[['UNKNOWN',12,0],['WO030',18,6],['WO160',6,6]]);assert.equal(r.plannedLabourHours,6);assert.equal(r.actualHours,4);assert.equal(r.recordedLabourCost,40);assert.equal(r.reconciledSpareCost,30);
const end=summarizeWorkOrderReview({...d,status:'closed',closedAt:'2026-11-15T09:00:00Z'},'2026-11-16T00:00:00Z','2026-11-15T00:00:00Z');assert.equal(end.overdueHours,9);
});
